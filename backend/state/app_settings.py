"""Canonical app settings schema and patch models."""

from __future__ import annotations

from typing import Any, TypeGuard, TypeVar, cast, get_args

from pydantic import BaseModel, ConfigDict, Field, create_model, field_validator

DEFAULT_LTX_API_BASE_URL = "https://api.ltx.video"
DEFAULT_FAL_API_BASE_URL = "https://fal.run"


def _to_camel_case(field_name: str) -> str:
    special_aliases = {
        "prompt_enhancer_enabled_t2v": "promptEnhancerEnabledT2V",
        "prompt_enhancer_enabled_i2v": "promptEnhancerEnabledI2V",
    }
    if field_name in special_aliases:
        return special_aliases[field_name]

    head, *tail = field_name.split("_")
    return head + "".join(part.title() for part in tail)


def _clamp_int(value: Any, minimum: int, maximum: int, default: int) -> int:
    if value is None:
        return default

    parsed = int(value)
    return max(minimum, min(maximum, parsed))


def _default_local_duration_caps() -> dict[str, int]:
    return {"540p": 20, "720p": 10, "1080p": 5, "1440p": 5, "2160p": 5}


def _normalize_base_url(value: Any, *, default: str) -> str:
    if value is None:
        return default
    normalized = str(value).strip().rstrip("/")
    return normalized or default


class SettingsBaseModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=_to_camel_case,
        populate_by_name=True,
        validate_assignment=True,
        extra="ignore",
    )


class SettingsPatchModel(SettingsBaseModel):
    model_config = ConfigDict(
        alias_generator=_to_camel_case,
        populate_by_name=True,
        validate_assignment=True,
        extra="forbid",
    )


class FastModelSettings(SettingsBaseModel):
    use_upscaler: bool = True


class ProModelSettings(SettingsBaseModel):
    steps: int = 20
    use_upscaler: bool = True

    @field_validator("steps", mode="before")
    @classmethod
    def _clamp_steps(cls, value: Any) -> int:
        return _clamp_int(value, minimum=1, maximum=100, default=20)


class AppSettings(SettingsBaseModel):
    use_torch_compile: bool = False
    load_on_startup: bool = False
    ltx_api_key: str = ""
    ltx_api_base_url: str = DEFAULT_LTX_API_BASE_URL
    user_prefers_ltx_api_video_generations: bool = False
    fal_api_key: str = ""
    fal_api_base_url: str = DEFAULT_FAL_API_BASE_URL
    use_local_text_encoder: bool = False
    fast_model: FastModelSettings = Field(default_factory=FastModelSettings)
    pro_model: ProModelSettings = Field(default_factory=ProModelSettings)
    prompt_cache_size: int = 100
    prompt_enhancer_enabled_t2v: bool = True
    prompt_enhancer_enabled_i2v: bool = False
    prompt_enhancer_base_url: str = ""
    prompt_enhancer_api_key: str = ""
    prompt_enhancer_model: str = ""
    seed_locked: bool = False
    locked_seed: int = 42
    models_dir: str = ""
    local_duration_cap_enabled: bool = True
    local_duration_caps: dict[str, int] = Field(default_factory=_default_local_duration_caps)

    @field_validator("prompt_cache_size", mode="before")
    @classmethod
    def _clamp_prompt_cache_size(cls, value: Any) -> int:
        return _clamp_int(value, minimum=0, maximum=1000, default=100)

    @field_validator("locked_seed", mode="before")
    @classmethod
    def _clamp_locked_seed(cls, value: Any) -> int:
        return _clamp_int(value, minimum=0, maximum=2_147_483_647, default=42)

    @field_validator("local_duration_caps", mode="before")
    @classmethod
    def _clamp_local_duration_caps(cls, value: Any) -> dict[str, int]:
        defaults = _default_local_duration_caps()
        if not isinstance(value, dict):
            return defaults
        result = dict(defaults)
        raw = cast(dict[Any, Any], value)
        for key, cap in raw.items():
            if isinstance(key, str) and key in defaults:
                result[key] = _clamp_int(cap, minimum=1, maximum=600, default=defaults[key])
        return result

    @field_validator("ltx_api_base_url", mode="before")
    @classmethod
    def _normalize_ltx_api_base_url(cls, value: Any) -> str:
        return _normalize_base_url(value, default=DEFAULT_LTX_API_BASE_URL)

    @field_validator("fal_api_base_url", mode="before")
    @classmethod
    def _normalize_fal_api_base_url(cls, value: Any) -> str:
        return _normalize_base_url(value, default=DEFAULT_FAL_API_BASE_URL)


SettingsModelT = TypeVar("SettingsModelT", bound=SettingsBaseModel)
_PARTIAL_MODEL_CACHE: dict[type[SettingsBaseModel], type[SettingsPatchModel]] = {}


def _wrap_optional(annotation: Any) -> Any:
    if type(None) in get_args(annotation):
        return annotation
    return annotation | None


def _to_partial_annotation(annotation: Any) -> Any:
    if _is_settings_model_annotation(annotation):
        return make_partial_model(annotation)
    return annotation


def make_partial_model(model: type[SettingsModelT]) -> type[SettingsPatchModel]:
    cached = _PARTIAL_MODEL_CACHE.get(model)
    if cached is not None:
        return cached

    fields: dict[str, tuple[Any, Any]] = {}
    for field_name, field_info in model.model_fields.items():
        partial_annotation = _wrap_optional(_to_partial_annotation(field_info.annotation))
        fields[field_name] = (partial_annotation, Field(default=None))

    partial_model = create_model(
        f"{model.__name__}Patch",
        __base__=SettingsPatchModel,
        **cast(Any, fields),
    )

    _PARTIAL_MODEL_CACHE[model] = partial_model
    return partial_model


def _is_settings_model_annotation(annotation: object) -> TypeGuard[type[SettingsBaseModel]]:
    return isinstance(annotation, type) and issubclass(annotation, SettingsBaseModel)


AppSettingsPatch = make_partial_model(AppSettings)
UpdateSettingsRequest = AppSettingsPatch


class SettingsResponse(SettingsBaseModel):
    use_torch_compile: bool = False
    load_on_startup: bool = False
    has_ltx_api_key: bool = False
    ltx_api_base_url: str = DEFAULT_LTX_API_BASE_URL
    user_prefers_ltx_api_video_generations: bool = False
    has_fal_api_key: bool = False
    fal_api_base_url: str = DEFAULT_FAL_API_BASE_URL
    use_local_text_encoder: bool = False
    fast_model: FastModelSettings = Field(default_factory=FastModelSettings)
    pro_model: ProModelSettings = Field(default_factory=ProModelSettings)
    prompt_cache_size: int = 100
    prompt_enhancer_enabled_t2v: bool = True
    prompt_enhancer_enabled_i2v: bool = False
    prompt_enhancer_base_url: str = ""
    prompt_enhancer_model: str = ""
    has_prompt_enhancer_api_key: bool = False
    seed_locked: bool = False
    locked_seed: int = 42
    models_dir: str = ""
    local_duration_cap_enabled: bool = True
    local_duration_caps: dict[str, int] = Field(default_factory=_default_local_duration_caps)


def to_settings_response(settings: AppSettings) -> SettingsResponse:
    data = settings.model_dump(by_alias=False)
    ltx_key = data.pop("ltx_api_key", "")
    fal_key = data.pop("fal_api_key", "")
    prompt_enhancer_key = data.pop("prompt_enhancer_api_key", "")
    data["has_ltx_api_key"] = bool(ltx_key)
    data["has_fal_api_key"] = bool(fal_key)
    data["has_prompt_enhancer_api_key"] = bool(prompt_enhancer_key)
    # models_dir and prompt_enhancer_base_url/model pass through as-is (not secret)
    return SettingsResponse.model_validate(data)


def should_video_generate_with_ltx_api(
    *,
    force_api_generations: bool,
    settings: AppSettings,
    allow_remote_services: bool = True,
) -> bool:
    if not allow_remote_services:
        return False

    has_ltx_api_key = bool(settings.ltx_api_key.strip())
    return force_api_generations or (
        settings.user_prefers_ltx_api_video_generations and has_ltx_api_key
    )
