"""Shared helpers and primitives for LTX video pipeline wrappers."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from importlib import import_module
from importlib.metadata import version
import threading
from typing import TYPE_CHECKING, Any, Protocol, cast

import torch

from api_types import ImageConditioningInput
from services.services_utils import AudioOrNone, TilingConfigType, device_supports_fp8, sync_device

if TYPE_CHECKING:
    from ltx_core.components.guiders import MultiModalGuiderParams
    from ltx_core.types import LatentState


_KEYFRAME_CONDITIONING_LOCK = threading.Lock()


@contextmanager
def guiding_image_conditionings(
    images: list[ImageConditioningInput],
    module_names: tuple[str, ...] = (),
) -> Iterator[None]:
    """Use pixel-frame keyframe positions for multi-keyframe generation.

    The pinned 1.0 pipelines hardcode ``image_conditionings_by_replacing_latent``.
    That helper interprets ``frame_idx`` as a latent-frame index, while the
    public request and ``VideoConditionByKeyframeIndex`` use pixel-frame
    positions.  Keep replacement semantics for ordinary frame-zero I2V and
    scope the upstream guiding-latent helper to calls containing another frame.
    """

    if not any(image.frame_idx != 0 for image in images):
        yield
        return

    helpers = import_module("ltx_pipelines.utils.helpers")
    guiding = getattr(helpers, "image_conditionings_by_adding_guiding_latent")
    targets = [helpers, *(import_module(name) for name in module_names)]

    with _KEYFRAME_CONDITIONING_LOCK:
        originals: list[tuple[object, object]] = []
        for target in targets:
            original = getattr(target, "image_conditionings_by_replacing_latent", None)
            if original is not None:
                originals.append((target, original))
                setattr(target, "image_conditionings_by_replacing_latent", guiding)
        try:
            yield
        finally:
            for target, original in reversed(originals):
                setattr(target, "image_conditionings_by_replacing_latent", original)


class _ModelPathsFactory(Protocol):
    @staticmethod
    def from_split(
        *,
        transformer_path: str,
        text_encoder_path: str | None,
        video_vae_path: str,
        audio_vae_path: str,
        duration_head_path: str | None,
    ) -> object: ...
    @staticmethod
    def from_monolith(
        checkpoint_path: str,
        gemma_root: str | None,
        *,
        video_vae_path: str | None,
    ) -> object: ...


def get_quantization_policy_class() -> type[Any]:
    """Load the pinned ltx-core 1.0 packages in their safe import order."""
    import_module("ltx_core.loader")
    module = import_module("ltx_core.quantization")
    return cast(type[Any], getattr(module, "QuantizationPolicy"))


def build_model_paths(
    checkpoint_path: str,
    gemma_root: str | None,
    *,
    video_vae_path: str | None = None,
    audio_vae_path: str | None = None,
    duration_head_path: str | None = None,
) -> object:
    """Build the ltx-pipelines 1.2 path object for monolith or split weights.

    The 1.3 pipeline API returns a named output and changes other call
    contracts, so this adapter deliberately rejects it until its wrapper is
    implemented and tested.
    """

    installed_version = version("ltx-pipelines")
    if not installed_version.startswith("1.2."):
        raise RuntimeError(
            "LTX_MODEL_PATHS_RUNTIME_UNSUPPORTED: split/monolith ModelPaths adapter requires "
            f"ltx-pipelines 1.2.x; installed {installed_version}"
        )

    model_paths = cast(
        _ModelPathsFactory,
        getattr(import_module("ltx_pipelines.utils.model_paths"), "ModelPaths"),
    )

    if (video_vae_path is None) != (audio_vae_path is None):
        raise ValueError("Split LTX models require both video and audio VAE paths")
    if video_vae_path is not None and audio_vae_path is not None:
        return model_paths.from_split(
            transformer_path=checkpoint_path,
            text_encoder_path=gemma_root,
            video_vae_path=video_vae_path,
            audio_vae_path=audio_vae_path,
            duration_head_path=duration_head_path,
        )
    return model_paths.from_monolith(checkpoint_path, gemma_root, video_vae_path=video_vae_path)


def default_tiling_config() -> TilingConfigType:
    from ltx_core.model.video_vae import TilingConfig

    return TilingConfig.default()


def default_guiders() -> tuple[MultiModalGuiderParams, MultiModalGuiderParams]:
    from ltx_core.components.guiders import MultiModalGuiderParams

    return MultiModalGuiderParams(cfg_scale=3.0), MultiModalGuiderParams(cfg_scale=3.0)


def video_chunks_number(num_frames: int, tiling_config: TilingConfigType | None) -> int:
    from ltx_core.model.video_vae import get_video_chunks_number

    return int(get_video_chunks_number(num_frames, tiling_config))


def encode_video_output(
    video: torch.Tensor | Iterator[torch.Tensor],
    audio: AudioOrNone,
    fps: int,
    output_path: str,
    video_chunks_number_value: int,
) -> None:
    from ltx_pipelines.utils.media_io import encode_video

    encode_video(
        video=video,
        fps=fps,
        audio=audio,
        output_path=output_path,
        video_chunks_number=video_chunks_number_value,
    )


class DistilledNativePipeline:
    """Fast native pipeline implementation moved from ltx2_server.py."""

    def __init__(
        self,
        checkpoint_path: str,
        gemma_root: str | None,
        device: torch.device | None = None,
        fp8transformer: bool = False,
    ) -> None:
        from ltx_pipelines.utils import ModelLedger
        from ltx_pipelines.utils.helpers import get_device
        from ltx_pipelines.utils.types import PipelineComponents

        if device is None:
            device = get_device()

        self.device = device
        self.dtype = torch.bfloat16

        QuantizationPolicy = get_quantization_policy_class()

        self.model_ledger = ModelLedger(
            dtype=self.dtype,
            device=device,
            checkpoint_path=checkpoint_path,
            gemma_root_path=gemma_root,
            loras=None,
            quantization=QuantizationPolicy.fp8_cast() if fp8transformer and device_supports_fp8(device) else None,
        )
        self.pipeline_components = PipelineComponents(dtype=self.dtype, device=device)

    @torch.inference_mode()
    def __call__(
        self,
        prompt: str,
        seed: int,
        height: int,
        width: int,
        num_frames: int,
        frame_rate: float,
        images: list[ImageConditioningInput],
        tiling_config: TilingConfigType | None = None,
    ) -> tuple[torch.Tensor | Iterator[torch.Tensor], AudioOrNone]:
        from ltx_core.components.diffusion_steps import EulerDiffusionStep
        from ltx_core.components.noisers import GaussianNoiser
        from ltx_core.model.audio_vae import decode_audio as vae_decode_audio
        from ltx_core.model.video_vae import decode_video as vae_decode_video
        from ltx_core.text_encoders.gemma import encode_text
        from ltx_core.types import VideoPixelShape
        from ltx_pipelines.utils.constants import DISTILLED_SIGMA_VALUES
        from ltx_pipelines.utils.args import ImageConditioningInput as _LtxImageInput
        from ltx_pipelines.utils.helpers import (
            cleanup_memory,
            denoise_audio_video,
            image_conditionings_by_replacing_latent,
            simple_denoising_func,
        )
        from ltx_pipelines.utils.samplers import euler_denoising_loop

        generator = torch.Generator(device=self.device).manual_seed(seed)
        noiser = GaussianNoiser(generator=generator)
        stepper = EulerDiffusionStep()
        dtype = torch.bfloat16

        text_encoder = self.model_ledger.text_encoder()
        context_p = encode_text(text_encoder, prompts=[prompt])[0]
        video_context, audio_context = context_p

        sync_device(self.device)
        del text_encoder
        cleanup_memory()

        video_encoder = self.model_ledger.video_encoder()
        transformer = self.model_ledger.transformer()
        sigmas = torch.Tensor(DISTILLED_SIGMA_VALUES).to(self.device)

        def denoising_loop(
            sigmas: torch.Tensor,
            video_state: LatentState,
            audio_state: LatentState,
            stepper: EulerDiffusionStep,
        ) -> tuple[LatentState, LatentState]:
            return euler_denoising_loop(
                sigmas=sigmas,
                video_state=video_state,
                audio_state=audio_state,
                stepper=stepper,
                denoise_fn=simple_denoising_func(
                    video_context=video_context,
                    audio_context=audio_context,
                    transformer=transformer,
                ),
            )

        output_shape = VideoPixelShape(batch=1, frames=num_frames, width=width, height=height, fps=frame_rate)
        conditionings = image_conditionings_by_replacing_latent(
            images=[_LtxImageInput(img.path, img.frame_idx, img.strength) for img in images],
            height=output_shape.height,
            width=output_shape.width,
            video_encoder=video_encoder,
            dtype=dtype,
            device=self.device,
        )

        video_state, audio_state = denoise_audio_video(
            output_shape=output_shape,
            conditionings=conditionings,
            noiser=noiser,
            sigmas=sigmas,
            stepper=stepper,
            denoising_loop_fn=cast(Any, denoising_loop),
            components=self.pipeline_components,
            dtype=dtype,
            device=self.device,
        )

        sync_device(self.device)
        del transformer
        del video_encoder
        cleanup_memory()

        decoded_video = vae_decode_video(video_state.latent, self.model_ledger.video_decoder(), tiling_config)
        decoded_audio = vae_decode_audio(
            audio_state.latent,
            self.model_ledger.audio_decoder(),
            self.model_ledger.vocoder(),
        )
        return decoded_video, decoded_audio
