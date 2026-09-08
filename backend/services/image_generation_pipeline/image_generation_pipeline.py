"""Image generation pipeline protocol definitions."""

from __future__ import annotations

from typing import Protocol

from PIL.Image import Image as PILImage

from services.services_utils import ImagePipelineOutputLike


class ImageGenerationPipeline(Protocol):
    @staticmethod
    def create(
        model_path: str,
        device: str | None = None,
    ) -> "ImageGenerationPipeline":
        ...

    def generate(
        self,
        prompt: str,
        height: int,
        width: int,
        guidance_scale: float,
        num_inference_steps: int,
        seed: int,
    ) -> ImagePipelineOutputLike:
        ...

    def edit(
        self,
        prompt: str,
        image: PILImage,
        strength: float,
        num_inference_steps: int,
        seed: int,
    ) -> ImagePipelineOutputLike:
        ...

    def to(self, device: str) -> None:
        ...
