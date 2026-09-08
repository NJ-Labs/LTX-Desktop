"""Version and capability contracts for current and future local LTX models."""

from __future__ import annotations

import pytest

from runtime_config.ltx_compatibility import (
    get_ltx_model_compatibility,
    is_runtime_compatible,
    supports_local_feature,
    validate_lora_model_allowlist,
)
from services.ltx_pipeline_common import build_model_paths


def test_ltx_25_uses_split_components_and_bounded_runtime() -> None:
    spec = get_ltx_model_compatibility("ltx-2.5-22b-distilled")

    assert spec.layout == "split"
    assert spec.components.video_vae is not None
    assert spec.components.audio_vae is not None
    assert spec.components.duration_head is not None
    assert is_runtime_compatible(spec.model_id, "1.2.0")
    assert is_runtime_compatible(spec.model_id, "1.2.9")
    assert not is_runtime_compatible(spec.model_id, "1.0.0")
    assert not is_runtime_compatible(spec.model_id, "1.3.0")


def test_ltx_25_does_not_advertise_unimplemented_extend_or_retake() -> None:
    assert not supports_local_feature("ltx-2.5-22b-distilled", "extend")
    assert not supports_local_feature("ltx-2.5-22b-distilled", "retake")
    assert supports_local_feature("ltx-2.5-22b-distilled", "multi_keyframe")


def test_ltx_25_lora_requires_explicit_model_allowlist() -> None:
    assert not validate_lora_model_allowlist("ltx-2.5-22b-distilled", ())
    assert not validate_lora_model_allowlist("ltx-2.5-22b-distilled", ("ltx-2.3-22b-distilled",))
    assert validate_lora_model_allowlist("ltx-2.5-22b-distilled", ("ltx-2.5-22b-distilled",))
    assert validate_lora_model_allowlist("ltx-2.3-22b-distilled", ())


def test_model_paths_adapter_fails_closed_on_current_legacy_runtime() -> None:
    with pytest.raises(RuntimeError, match="requires ltx-pipelines 1.2.x; installed 1.0.0"):
        build_model_paths("transformer.safetensors", "gemma")
