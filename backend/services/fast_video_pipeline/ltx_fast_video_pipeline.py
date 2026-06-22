"""LTX fast video pipeline wrapper."""

from __future__ import annotations

from collections.abc import Callable, Iterator
from contextlib import contextmanager
import os
from typing import Any, Final, cast

import torch

from api_types import ImageConditioningInput
from services.ltx_pipeline_common import (
    DistilledNativePipeline,
    default_tiling_config,
    encode_video_output,
    video_chunks_number,
)
from services.services_utils import AudioOrNone, TilingConfigType, device_supports_fp8


def total_denoising_steps(use_upscaler: bool = True) -> int:
    from ltx_pipelines.utils.constants import DISTILLED_SIGMA_VALUES, STAGE_2_DISTILLED_SIGMA_VALUES

    stage_1_steps = len(DISTILLED_SIGMA_VALUES) - 1
    if not use_upscaler:
        return stage_1_steps
    return stage_1_steps + (len(STAGE_2_DISTILLED_SIGMA_VALUES) - 1)


StepCallback = Callable[[int, int], None]  # (current_step, total_steps)


@contextmanager
def _tqdm_progress_interceptor(callback: StepCallback, total_steps: int) -> Iterator[None]:
    """Patch tqdm in ltx_pipelines.utils.samplers to forward step updates to callback.

    The denoising loops in samplers.py use tqdm directly with no external
    callback hook. We replace tqdm there with a thin wrapper that calls
    callback(current_step, total_steps) on each iteration.
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
                callback(_step_counter[0], total_steps)

        def __len__(self) -> int:
            return len(self._items)

    try:
        _samplers_module.tqdm = _ProgressTqdm  # type: ignore[attr-defined]
        yield
    finally:
        _samplers_module.tqdm = original_tqdm  # type: ignore[attr-defined]


class LTXFastVideoPipeline:
    pipeline_kind: Final = "fast"

    @staticmethod
    def create(
        checkpoint_path: str,
        gemma_root: str | None,
        upsampler_path: str,
        use_upscaler: bool,
        device: torch.device,
    ) -> "LTXFastVideoPipeline":
        return LTXFastVideoPipeline(
            checkpoint_path=checkpoint_path,
            gemma_root=gemma_root,
            upsampler_path=upsampler_path,
            use_upscaler=use_upscaler,
            device=device,
        )

    def __init__(
        self,
        checkpoint_path: str,
        gemma_root: str | None,
        upsampler_path: str,
        use_upscaler: bool,
        device: torch.device,
    ) -> None:
        self.use_upscaler = use_upscaler
        if use_upscaler:
            from ltx_core.quantization import QuantizationPolicy
            from ltx_pipelines.distilled import DistilledPipeline

            self.pipeline: Any = DistilledPipeline(
                distilled_checkpoint_path=checkpoint_path,
                gemma_root=cast(str, gemma_root),
                spatial_upsampler_path=upsampler_path,
                loras=[],
                device=device,
                quantization=QuantizationPolicy.fp8_cast() if device_supports_fp8(device) else None,
            )
        else:
            self.pipeline = DistilledNativePipeline(
                checkpoint_path=checkpoint_path,
                gemma_root=gemma_root,
                device=device,
                fp8transformer=device_supports_fp8(device),
            )

    def _run_inference(
        self,
        prompt: str,
        seed: int,
        height: int,
        width: int,
        num_frames: int,
        frame_rate: float,
        images: list[ImageConditioningInput],
        tiling_config: TilingConfigType,
    ) -> tuple[torch.Tensor | Iterator[torch.Tensor], AudioOrNone]:
        from ltx_pipelines.utils.args import ImageConditioningInput as _LtxImageInput

        return self.pipeline(
            prompt=prompt,
            seed=seed,
            height=height,
            width=width,
            num_frames=num_frames,
            frame_rate=frame_rate,
            images=[_LtxImageInput(img.path, img.frame_idx, img.strength) for img in images],
            tiling_config=tiling_config,
        )

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
        del num_inference_steps, negative_prompt  # fast pipeline uses fixed distilled sigmas
        tiling_config = default_tiling_config()
        if progress_callback is not None:
            with _tqdm_progress_interceptor(progress_callback, total_denoising_steps(self.use_upscaler)):
                video, audio = self._run_inference(
                    prompt=prompt,
                    seed=seed,
                    height=height,
                    width=width,
                    num_frames=num_frames,
                    frame_rate=frame_rate,
                    images=images,
                    tiling_config=tiling_config,
                )
        else:
            video, audio = self._run_inference(
                prompt=prompt,
                seed=seed,
                height=height,
                width=width,
                num_frames=num_frames,
                frame_rate=frame_rate,
                images=images,
                tiling_config=tiling_config,
            )
        chunks = video_chunks_number(num_frames, tiling_config)
        encode_video_output(video=video, audio=audio, fps=int(frame_rate), output_path=output_path, video_chunks_number_value=chunks)

    @torch.inference_mode()
    def warmup(self, output_path: str) -> None:
        warmup_frames = 9
        tiling_config = default_tiling_config()

        try:
            video, audio = self._run_inference(
                prompt="test warmup",
                seed=42,
                height=256,
                width=384,
                num_frames=warmup_frames,
                frame_rate=8,
                images=[],
                tiling_config=tiling_config,
            )
            chunks = video_chunks_number(warmup_frames, tiling_config)
            encode_video_output(video=video, audio=audio, fps=8, output_path=output_path, video_chunks_number_value=chunks)
        finally:
            if os.path.exists(output_path):
                os.unlink(output_path)

    def compile_transformer(self) -> None:
        transformer = self.pipeline.model_ledger.transformer()

        compiled = cast(
            torch.nn.Module,
            torch.compile(transformer, mode="reduce-overhead", fullgraph=False),  # type: ignore[reportUnknownMemberType]
        )
        setattr(self.pipeline.model_ledger, "transformer", lambda: compiled)
