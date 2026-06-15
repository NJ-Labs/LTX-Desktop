"""Pro (full model) video pipeline protocol definitions."""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING, ClassVar, Literal, Protocol

from api_types import ImageConditioningInput

if TYPE_CHECKING:
    import torch


class ProVideoPipeline(Protocol):
    pipeline_kind: ClassVar[Literal["pro"]]
    use_upscaler: bool

    @staticmethod
    def create(
        checkpoint_path: str,
        gemma_root: str | None,
        upsampler_path: str,
        distilled_lora_path: str,
        use_upscaler: bool,
        device: torch.device,
    ) -> "ProVideoPipeline":
        ...

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
        progress_callback: Callable[[int, int], None] | None = None,
        *,
        num_inference_steps: int = 0,
        negative_prompt: str = "",
    ) -> None:
        ...

    def warmup(self, output_path: str) -> None:
        ...

    def compile_transformer(self) -> None:
        ...
