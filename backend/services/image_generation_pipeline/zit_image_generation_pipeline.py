"""Z-Image-Turbo image generation pipeline wrapper."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, cast

import torch
from PIL.Image import Image as PILImage

from services.services_utils import ImagePipelineOutputLike, PILImageType, get_device_type


@dataclass(slots=True)
class _ZImageOutput:
    images: Sequence[PILImageType]


class ZitImageGenerationPipeline:
    @staticmethod
    def create(
        model_path: str,
        device: str | None = None,
    ) -> "ZitImageGenerationPipeline":
        return ZitImageGenerationPipeline(model_path=model_path, device=device)

    def __init__(self, model_path: str, device: str | None = None) -> None:
        from diffusers.pipelines.auto_pipeline import ZImagePipeline  # type: ignore[reportUnknownVariableType]

        self._device: str | None = None
        self._cpu_offload_active = False
        self._img2img: Any | None = None
        self.pipeline = ZImagePipeline.from_pretrained(  # type: ignore[reportUnknownMemberType]
            model_path,
            torch_dtype=torch.bfloat16,
        )
        if device is not None:
            self.to(device)

    def _resolve_generator_device(self) -> str:
        if self._cpu_offload_active:
            return "cuda"
        if self._device is not None:
            return self._device

        execution_device = getattr(self.pipeline, "_execution_device", None)
        return get_device_type(execution_device)

    @staticmethod
    def _normalize_output(output: object) -> ImagePipelineOutputLike:
        images = getattr(output, "images", None)
        if not isinstance(images, Sequence):
            raise RuntimeError("Unexpected ZIT pipeline output format: missing images sequence")

        images_list = cast(Sequence[object], images)
        validated_images: list[PILImageType] = []
        for image in images_list:
            if not isinstance(image, PILImage):
                raise RuntimeError("Unexpected ZIT pipeline output format: images must be PIL.Image instances")
            validated_images.append(image)

        return _ZImageOutput(images=validated_images)

    @torch.inference_mode()
    def generate(
        self,
        prompt: str,
        height: int,
        width: int,
        guidance_scale: float,
        num_inference_steps: int,
        seed: int,
    ) -> ImagePipelineOutputLike:
        # ZImagePipeline ignores guidance_scale, so we drop it explicitly.
        _ = guidance_scale
        generator = torch.Generator(device=self._resolve_generator_device()).manual_seed(seed)
        pipeline = cast(Any, self.pipeline)
        output = pipeline(
            prompt=prompt,
            height=height,
            width=width,
            guidance_scale=0.0,
            num_inference_steps=num_inference_steps,
            generator=generator,
            output_type="pil",
            return_dict=True,
        )
        return self._normalize_output(output)

    def _ensure_img2img_pipeline(self) -> Any:
        if self._img2img is not None:
            return self._img2img
        try:
            from diffusers import ZImageImg2ImgPipeline  # type: ignore[attr-defined]
        except Exception as exc:
            raise RuntimeError("DIFFUSERS_IMG2IMG_UNAVAILABLE") from exc

        pipeline = cast(Any, self.pipeline)
        self._img2img = ZImageImg2ImgPipeline(**pipeline.components)  # type: ignore[reportUnknownMemberType]
        return self._img2img

    @torch.inference_mode()
    def edit(
        self,
        prompt: str,
        image: PILImageType,
        strength: float,
        num_inference_steps: int,
        seed: int,
    ) -> ImagePipelineOutputLike:
        pipeline = self._ensure_img2img_pipeline()
        generator = torch.Generator(device=self._resolve_generator_device()).manual_seed(seed)
        output = pipeline(
            prompt=prompt,
            image=image,
            strength=strength,
            num_inference_steps=num_inference_steps,
            guidance_scale=0.0,
            generator=generator,
            output_type="pil",
            return_dict=True,
        )
        return self._normalize_output(output)

    def to(self, device: str) -> None:
        runtime_device = get_device_type(device)
        if runtime_device == "cuda":
            self.pipeline.enable_model_cpu_offload()  # type: ignore[reportUnknownMemberType]
            self._cpu_offload_active = True
        else:
            self._cpu_offload_active = False
            self.pipeline.to(runtime_device)  # type: ignore[reportUnknownMemberType]
        self._device = runtime_device
        self._img2img = None
