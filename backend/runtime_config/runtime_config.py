"""Runtime configuration model."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

import torch

from runtime_config.model_download_specs import ModelFileDownloadSpec
from state.app_state_types import ModelFileType


@dataclass
class RuntimeConfig:
    device: torch.device
    default_models_dir: Path
    model_download_specs: Mapping[ModelFileType, ModelFileDownloadSpec]
    required_model_types: frozenset[ModelFileType]
    outputs_dir: Path
    settings_file: Path
    library_file: Path
    app_data_dir: Path
    ltx_api_base_url: str
    force_api_generations: bool
    use_sage_attention: bool
    camera_motion_prompts: dict[str, str]
    default_negative_prompt: str
    forced_models_dir: Path | None = None
    startup_preload_models: bool = False
    require_local_mode: bool = False
    offline_mode: bool = False

    def spec_for(self, model_type: ModelFileType) -> ModelFileDownloadSpec:
        return self.model_download_specs[model_type]
