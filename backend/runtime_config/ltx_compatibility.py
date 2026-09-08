"""Versioned local LTX model contracts.

The running application still uses the LTX 2.3 monolithic checkpoint through
ltx-pipelines 1.0. LTX 2.5 uses split component files and the 1.2 pipeline API.
Keeping those contracts explicit prevents a new checkpoint from being sent to
the old monolithic loader, or a later incompatible pipeline API from being
accepted by a broad ``>=`` check.
"""

from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Literal

LtxLocalModelId = Literal["ltx-2.3-22b-distilled", "ltx-2.5-22b-distilled"]
LtxModelLayout = Literal["monolith", "split"]
LtxFeature = Literal[
    "t2v",
    "i2v",
    "a2v",
    "ic_lora",
    "retake",
    "extend",
    "multi_keyframe",
    "user_loras",
]


@dataclass(frozen=True, slots=True)
class LtxRuntimeBand:
    minimum: tuple[int, int, int]
    maximum_exclusive: tuple[int, int, int]


@dataclass(frozen=True, slots=True)
class LtxModelComponents:
    transformer: str
    text_encoder: str
    spatial_upsampler: str
    video_vae: str | None = None
    audio_vae: str | None = None
    duration_head: str | None = None


@dataclass(frozen=True, slots=True)
class LtxModelCompatibility:
    model_id: LtxLocalModelId
    layout: LtxModelLayout
    runtime_band: LtxRuntimeBand
    components: LtxModelComponents
    capabilities: frozenset[LtxFeature]
    requires_lora_allowlist: bool


_LTX_2_3 = LtxModelCompatibility(
    model_id="ltx-2.3-22b-distilled",
    layout="monolith",
    runtime_band=LtxRuntimeBand((1, 0, 0), (1, 2, 0)),
    components=LtxModelComponents(
        transformer="ltx-2.3-22b-distilled.safetensors",
        text_encoder="gemma-3-12b-it-qat-q4_0-unquantized",
        spatial_upsampler="ltx-2.3-spatial-upscaler-x2-1.0.safetensors",
    ),
    capabilities=frozenset({"t2v", "i2v", "a2v", "ic_lora", "retake", "extend", "multi_keyframe"}),
    requires_lora_allowlist=False,
)

_LTX_2_5 = LtxModelCompatibility(
    model_id="ltx-2.5-22b-distilled",
    layout="split",
    runtime_band=LtxRuntimeBand((1, 2, 0), (1, 3, 0)),
    components=LtxModelComponents(
        transformer="ltx-2.5/ltx-2.5-22b-distilled-transformer-bf16.safetensors",
        text_encoder="ltx-2.5/gemma4-12b-with-proj-ltx-2.5-bf16.safetensors",
        spatial_upsampler="ltx-2.5/ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors",
        video_vae="ltx-2.5/ltx-2.5-video-vae-bf16.safetensors",
        audio_vae="ltx-2.5/ltx-2.5-audio-vae-bf16.safetensors",
        duration_head="ltx-2.5/ltx-2.5-duration-head-bf16.safetensors",
    ),
    capabilities=frozenset({"t2v", "i2v", "a2v", "multi_keyframe", "user_loras"}),
    requires_lora_allowlist=True,
)

_MODEL_COMPATIBILITY: dict[LtxLocalModelId, LtxModelCompatibility] = {
    _LTX_2_3.model_id: _LTX_2_3,
    _LTX_2_5.model_id: _LTX_2_5,
}


def get_ltx_model_compatibility(model_id: LtxLocalModelId) -> LtxModelCompatibility:
    return _MODEL_COMPATIBILITY[model_id]


def supports_local_feature(model_id: LtxLocalModelId, feature: LtxFeature) -> bool:
    return feature in get_ltx_model_compatibility(model_id).capabilities


def parse_release_version(raw_version: str) -> tuple[int, int, int]:
    match = re.match(r"^(\d+)\.(\d+)(?:\.(\d+))?", raw_version)
    if match is None:
        raise ValueError(f"Unrecognized ltx-pipelines version: {raw_version}")
    major, minor, patch = match.groups()
    return int(major), int(minor), int(patch or 0)


def is_runtime_compatible(model_id: LtxLocalModelId, installed_version: str) -> bool:
    installed = parse_release_version(installed_version)
    band = get_ltx_model_compatibility(model_id).runtime_band
    return band.minimum <= installed < band.maximum_exclusive


def validate_lora_model_allowlist(
    model_id: LtxLocalModelId,
    supported_models: tuple[str, ...],
) -> bool:
    """Require catalog evidence before applying a LoRA to LTX 2.5 weights."""

    spec = get_ltx_model_compatibility(model_id)
    if not spec.requires_lora_allowlist:
        return True
    return model_id in supported_models
