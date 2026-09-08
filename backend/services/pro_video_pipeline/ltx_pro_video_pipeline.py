"""LTX pro (full model) video pipeline wrapper.

Wraps the non-distilled LTX-2.3 pipelines for local "Pro" generation using the
full ``ltx-2.3-22b-dev`` checkpoint:

* ``use_upscaler=True``  -> :class:`TI2VidTwoStagesPipeline` (stage 1 at half
  resolution with the full model + CFG, stage 2 upsamples 2x and refines with
  the distilled LoRA). Highest quality, 2x upscaled output.
* ``use_upscaler=False`` -> :class:`TI2VidOneStagePipeline` (single pass at the
  target resolution, no spatial upsampler).

The number of inference steps is supplied per-generation; ``use_upscaler`` is
baked in at construction time because it selects the underlying pipeline class.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from contextlib import contextmanager
import os
from typing import Any, Final, cast

import torch

from api_types import ImageConditioningInput
from services.ltx_pipeline_common import (
    default_tiling_config,
    encode_video_output,
    get_quantization_policy_class,
    guiding_image_conditionings,
    video_chunks_number,
)
from services.services_utils import AudioOrNone, device_supports_fp8

StepCallback = Callable[[int, int], None]  # (current_step, total_steps)


def _stage_2_steps() -> int:
    from ltx_pipelines.utils.constants import STAGE_2_DISTILLED_SIGMA_VALUES

    return len(STAGE_2_DISTILLED_SIGMA_VALUES) - 1


@contextmanager
def _tqdm_progress_interceptor(callback: StepCallback, total_steps: int) -> Iterator[None]:
    """Patch tqdm in ltx_pipelines.utils.samplers to forward step updates.

    The denoising loops use tqdm directly with no external callback hook, so we
    replace it with a thin wrapper that reports ``callback(current, total)`` on
    each iteration. The counter accumulates across both stages of the two-stage
    pipeline.
    """
    import ltx_pipelines.utils.samplers as _samplers_module

    _step_counter: list[int] = [0]
    original_tqdm = _samplers_module.tqdm

    class _ProgressTqdm:
        def __init__(self, iterable: Any = None, **kwargs: Any) -> None:
            self._items: list[Any] = list(iterable) if iterable is not None else []
            self._tqdm = original_tqdm(self._items, **kwargs)

        def __iter__(self) -> Iterator[Any]:
            for item in self._tqdm:
                yield item
                _step_counter[0] += 1
                callback(min(_step_counter[0], total_steps), total_steps)

        def __len__(self) -> int:
            return len(self._items)

    try:
        _samplers_module.tqdm = _ProgressTqdm  # type: ignore[attr-defined]
        yield
    finally:
        _samplers_module.tqdm = original_tqdm  # type: ignore[attr-defined]


class LTXProVideoPipeline:
    pipeline_kind: Final = "pro"

    @staticmethod
    def create(
        checkpoint_path: str,
        gemma_root: str | None,
        upsampler_path: str,
        distilled_lora_path: str,
        use_upscaler: bool,
        device: torch.device,
    ) -> "LTXProVideoPipeline":
        return LTXProVideoPipeline(
            checkpoint_path=checkpoint_path,
            gemma_root=gemma_root,
            upsampler_path=upsampler_path,
            distilled_lora_path=distilled_lora_path,
            use_upscaler=use_upscaler,
            device=device,
        )

    def __init__(
        self,
        checkpoint_path: str,
        gemma_root: str | None,
        upsampler_path: str,
        distilled_lora_path: str,
        use_upscaler: bool,
        device: torch.device,
    ) -> None:
        from ltx_core.loader import LTXV_LORA_COMFY_RENAMING_MAP, LoraPathStrengthAndSDOps
        from ltx_pipelines.utils.constants import detect_params

        QuantizationPolicy = get_quantization_policy_class()
        self.use_upscaler = use_upscaler

        params = detect_params(checkpoint_path)
        self._video_guider_params = params.video_guider_params
        self._audio_guider_params = params.audio_guider_params

        quantization = QuantizationPolicy.fp8_cast() if device_supports_fp8(device) else None

        self._two_stage: Any | None = None
        self._one_stage: Any | None = None

        if use_upscaler:
            from ltx_pipelines.ti2vid_two_stages import TI2VidTwoStagesPipeline

            distilled_lora = [
                LoraPathStrengthAndSDOps(distilled_lora_path, 1.0, LTXV_LORA_COMFY_RENAMING_MAP)
            ]
            self._two_stage = TI2VidTwoStagesPipeline(
                checkpoint_path=checkpoint_path,
                distilled_lora=distilled_lora,
                spatial_upsampler_path=upsampler_path,
                gemma_root=cast(str, gemma_root),
                loras=[],
                device=device,
                quantization=quantization,
            )
        else:
            from ltx_pipelines.ti2vid_one_stage import TI2VidOneStagePipeline

            self._one_stage = TI2VidOneStagePipeline(
                checkpoint_path=checkpoint_path,
                gemma_root=cast(str, gemma_root),
                loras=[],
                device=device,
                quantization=quantization,
            )

    def _to_ltx_images(self, images: list[ImageConditioningInput]) -> list[Any]:
        from ltx_pipelines.utils.args import ImageConditioningInput as _LtxImageInput

        return [_LtxImageInput(img.path, img.frame_idx, img.strength) for img in images]

    def _run_two_stage(
        self,
        prompt: str,
        negative_prompt: str,
        seed: int,
        height: int,
        width: int,
        num_frames: int,
        frame_rate: float,
        num_inference_steps: int,
        images: list[ImageConditioningInput],
    ) -> tuple[torch.Tensor | Iterator[torch.Tensor], AudioOrNone, int]:
        assert self._two_stage is not None
        tiling_config = default_tiling_config()
        with guiding_image_conditionings(images, ("ltx_pipelines.ti2vid_two_stages",)):
            video, audio = self._two_stage(
                prompt=prompt,
                negative_prompt=negative_prompt,
                seed=seed,
                height=height,
                width=width,
                num_frames=num_frames,
                frame_rate=frame_rate,
                num_inference_steps=num_inference_steps,
                video_guider_params=self._video_guider_params,
                audio_guider_params=self._audio_guider_params,
                images=self._to_ltx_images(images),
                tiling_config=tiling_config,
            )
        return video, audio, video_chunks_number(num_frames, tiling_config)

    def _run_one_stage(
        self,
        prompt: str,
        negative_prompt: str,
        seed: int,
        height: int,
        width: int,
        num_frames: int,
        frame_rate: float,
        num_inference_steps: int,
        images: list[ImageConditioningInput],
    ) -> tuple[torch.Tensor | Iterator[torch.Tensor], AudioOrNone, int]:
        assert self._one_stage is not None
        with guiding_image_conditionings(images, ("ltx_pipelines.ti2vid_one_stage",)):
            video, audio = self._one_stage(
                prompt=prompt,
                negative_prompt=negative_prompt,
                seed=seed,
                height=height,
                width=width,
                num_frames=num_frames,
                frame_rate=frame_rate,
                num_inference_steps=num_inference_steps,
                video_guider_params=self._video_guider_params,
                audio_guider_params=self._audio_guider_params,
                images=self._to_ltx_images(images),
            )
        return video, audio, 1

    def _total_steps(self, num_inference_steps: int) -> int:
        if self.use_upscaler:
            return num_inference_steps + _stage_2_steps()
        return num_inference_steps

    @torch.inference_mode()
    def generate(
        self,
        prompt: str,
        seed: int,
        height: int,
        width: int,
        num_frames: int,
        frame_rate: float,
        images: list[ImageConditioningInput],
        output_path: str,
        progress_callback: StepCallback | None = None,
        *,
        num_inference_steps: int = 0,
        negative_prompt: str = "",
    ) -> None:
        steps = num_inference_steps if num_inference_steps > 0 else 30

        def _run() -> tuple[torch.Tensor | Iterator[torch.Tensor], AudioOrNone, int]:
            if self.use_upscaler:
                return self._run_two_stage(
                    prompt=prompt,
                    negative_prompt=negative_prompt,
                    seed=seed,
                    height=height,
                    width=width,
                    num_frames=num_frames,
                    frame_rate=frame_rate,
                    num_inference_steps=steps,
                    images=images,
                )
            return self._run_one_stage(
                prompt=prompt,
                negative_prompt=negative_prompt,
                seed=seed,
                height=height,
                width=width,
                num_frames=num_frames,
                frame_rate=frame_rate,
                num_inference_steps=steps,
                images=images,
            )

        if progress_callback is not None:
            with _tqdm_progress_interceptor(progress_callback, self._total_steps(steps)):
                video, audio, chunks = _run()
        else:
            video, audio, chunks = _run()

        encode_video_output(
            video=video,
            audio=audio,
            fps=int(frame_rate),
            output_path=output_path,
            video_chunks_number_value=chunks,
        )

    @torch.inference_mode()
    def warmup(self, output_path: str) -> None:
        warmup_frames = 9
        try:
            if self.use_upscaler:
                video, audio, chunks = self._run_two_stage(
                    prompt="test warmup",
                    negative_prompt="",
                    seed=42,
                    height=256,
                    width=384,
                    num_frames=warmup_frames,
                    frame_rate=8,
                    num_inference_steps=4,
                    images=[],
                )
            else:
                video, audio, chunks = self._run_one_stage(
                    prompt="test warmup",
                    negative_prompt="",
                    seed=42,
                    height=256,
                    width=384,
                    num_frames=warmup_frames,
                    frame_rate=8,
                    num_inference_steps=4,
                    images=[],
                )
            encode_video_output(
                video=video, audio=audio, fps=8, output_path=output_path, video_chunks_number_value=chunks
            )
        finally:
            if os.path.exists(output_path):
                os.unlink(output_path)

    def compile_transformer(self) -> None:
        # torch.compile of the full 22B transformer is intentionally skipped:
        # it is opt-in (use_torch_compile) and unverified for the pro path.
        return None
