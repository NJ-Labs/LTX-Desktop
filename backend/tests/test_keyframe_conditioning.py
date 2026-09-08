from pathlib import Path
from typing import cast

import torch
from PIL import Image
import pytest

from api_types import ImageConditioningInput
from services.ltx_pipeline_common import guiding_image_conditionings


class _IdentityVideoEncoder:
    def __call__(self, image: torch.Tensor) -> torch.Tensor:
        return image


def test_nonzero_pixel_frame_uses_guiding_keyframe_conditioning(tmp_path: Path) -> None:
    from ltx_core.conditioning import VideoConditionByKeyframeIndex
    from ltx_pipelines.utils import helpers
    from ltx_pipelines.utils.args import ImageConditioningInput as LtxImageConditioningInput

    image_path = tmp_path / "end.png"
    Image.new("RGB", (64, 64), "white").save(image_path)
    original = helpers.image_conditionings_by_replacing_latent
    request_images = [
        ImageConditioningInput(path=str(image_path), frame_idx=0, strength=1.0),
        ImageConditioningInput(path=str(image_path), frame_idx=48, strength=0.8),
    ]
    pipeline_images = [
        LtxImageConditioningInput(str(image_path), 0, 1.0),
        LtxImageConditioningInput(str(image_path), 48, 0.8),
    ]

    with guiding_image_conditionings(request_images):
        conditionings = helpers.image_conditionings_by_replacing_latent(
            images=pipeline_images,
            height=64,
            width=64,
            video_encoder=_IdentityVideoEncoder(),  # type: ignore[arg-type]
            dtype=torch.float32,
            device=torch.device("cpu"),
        )
        assert all(isinstance(item, VideoConditionByKeyframeIndex) for item in conditionings)
        keyframes = [cast(VideoConditionByKeyframeIndex, item) for item in conditionings]
        assert [(item.frame_idx, item.strength) for item in keyframes] == [(0, 1.0), (48, 0.8)]

    assert helpers.image_conditionings_by_replacing_latent is original


def test_frame_zero_keeps_latent_replacement_semantics() -> None:
    from ltx_pipelines.utils import helpers

    original = helpers.image_conditionings_by_replacing_latent
    images = [ImageConditioningInput(path="unused.png", frame_idx=0, strength=1.0)]

    with guiding_image_conditionings(images):
        assert helpers.image_conditionings_by_replacing_latent is original


def test_pipeline_module_helper_is_restored_after_failure() -> None:
    import ltx_pipelines.distilled as distilled
    from ltx_pipelines.utils.helpers import image_conditionings_by_adding_guiding_latent

    original = distilled.image_conditionings_by_replacing_latent
    images = [ImageConditioningInput(path="unused.png", frame_idx=48, strength=0.8)]

    with pytest.raises(RuntimeError, match="synthetic failure"):
        with guiding_image_conditionings(images, ("ltx_pipelines.distilled",)):
            assert distilled.image_conditionings_by_replacing_latent is image_conditionings_by_adding_guiding_latent
            raise RuntimeError("synthetic failure")

    assert distilled.image_conditionings_by_replacing_latent is original
