"""Device placement tests for the native Z-Image pipeline."""

from __future__ import annotations

from dataclasses import dataclass

from PIL import Image

from services.image_generation_pipeline.zit_image_generation_pipeline import ZitImageGenerationPipeline


class _PlacementRecorder:
    def __init__(self) -> None:
        self.offload_calls = 0
        self.to_calls: list[str] = []

    def enable_model_cpu_offload(self) -> None:
        self.offload_calls += 1

    def to(self, device: str) -> None:
        self.to_calls.append(device)


@dataclass
class _ImageOutput:
    images: list[Image.Image]


class _Img2ImgRecorder:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def __call__(self, **kwargs: object) -> _ImageOutput:
        self.calls.append(kwargs)
        return _ImageOutput(images=[Image.new("RGB", (16, 16), "green")])


def _pipeline_with_recorder() -> tuple[ZitImageGenerationPipeline, _PlacementRecorder]:
    recorder = _PlacementRecorder()
    pipeline = object.__new__(ZitImageGenerationPipeline)
    pipeline.pipeline = recorder
    pipeline._device = None  # noqa: SLF001 - construct without loading model weights
    pipeline._cpu_offload_active = False  # noqa: SLF001
    return pipeline, recorder


def test_mps_moves_pipeline_without_enabling_cuda_cpu_offload() -> None:
    pipeline, recorder = _pipeline_with_recorder()

    pipeline.to("mps")

    assert recorder.offload_calls == 0
    assert recorder.to_calls == ["mps"]
    assert pipeline._cpu_offload_active is False  # noqa: SLF001
    assert pipeline._device == "mps"  # noqa: SLF001


def test_cuda_enables_model_cpu_offload() -> None:
    pipeline, recorder = _pipeline_with_recorder()

    pipeline.to("cuda")

    assert recorder.offload_calls == 1
    assert recorder.to_calls == []
    assert pipeline._cpu_offload_active is True  # noqa: SLF001
    assert pipeline._device == "cuda"  # noqa: SLF001


def test_edit_uses_guidance_free_img2img_pipeline() -> None:
    pipeline, _ = _pipeline_with_recorder()
    img2img = _Img2ImgRecorder()
    pipeline._device = "cpu"  # noqa: SLF001
    pipeline._img2img = img2img  # noqa: SLF001
    source = Image.new("RGB", (32, 32), "red")

    result = pipeline.edit(
        prompt="turn it green",
        image=source,
        strength=0.6,
        num_inference_steps=4,
        seed=42,
    )

    assert len(result.images) == 1
    call = img2img.calls[0]
    assert call["image"] is source
    assert call["strength"] == 0.6
    assert call["guidance_scale"] == 0.0
