"""Pydantic request/response models and TypedDicts for ltx2_server."""

from __future__ import annotations

from typing import Literal, NamedTuple, TypeAlias, TypedDict
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

NonEmptyPrompt = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
ModelFileType = Literal[
    "checkpoint",
    "dev_checkpoint",
    "upsampler",
    "spatial_upscaler_x2_v11",
    "spatial_upscaler_x15",
    "distilled_lora",
    "distilled_lora_384",
    "distilled_lora_384_v11",
    "ic_lora",
    "ic_lora_ingredients",
    "depth_processor",
    "person_detector",
    "pose_processor",
    "text_encoder",
    "zit",
]


class ImageConditioningInput(NamedTuple):
    """Image conditioning triplet used by all video pipelines."""

    path: str
    frame_idx: int
    strength: float


# ============================================================
# TypedDicts for module-level state globals
# ============================================================


class GenerationState(TypedDict):
    id: str | None
    cancelled: bool
    result: str | list[str] | None
    error: str | None
    status: str  # "idle" | "running" | "complete" | "cancelled" | "error"
    phase: str
    progress: int
    current_step: int
    total_steps: int


JsonObject: TypeAlias = dict[str, object]
VideoCameraMotion = Literal[
    "none",
    "dolly_in",
    "dolly_out",
    "dolly_left",
    "dolly_right",
    "jib_up",
    "jib_down",
    "static",
    "focus_shift",
]


# ============================================================
# Response Models
# ============================================================


class ModelStatusItem(BaseModel):
    id: str
    name: str
    loaded: bool
    downloaded: bool


class GpuTelemetry(BaseModel):
    name: str
    vram: int
    vramUsed: int


class HealthResponse(BaseModel):
    status: str
    models_loaded: bool
    active_model: str | None
    gpu_info: GpuTelemetry
    sage_attention: bool
    models_status: list[ModelStatusItem]


class GpuInfoResponse(BaseModel):
    cuda_available: bool
    mps_available: bool = False
    gpu_available: bool = False
    gpu_name: str | None
    vram_gb: int | None
    gpu_info: GpuTelemetry


class RuntimePolicyResponse(BaseModel):
    force_api_generations: bool
    offline_mode: bool = False
    data_dir: str = ""


class GenerationProgressResponse(BaseModel):
    status: str
    phase: str
    progress: int
    currentStep: int | None
    totalSteps: int | None
    # Result payload, populated once the generation reaches a terminal state so
    # async (non-blocking) clients can fetch the output by polling alone.
    videoPath: str | None = None
    imagePaths: list[str] | None = None
    error: str | None = None
    # Milliseconds since the backend last updated generation progress. Lets the
    # UI detect a stalled backend ("live-check") during long generations.
    heartbeatAgeMs: int | None = None


class ModelInfo(BaseModel):
    id: str
    name: str
    description: str


class ModelFileStatus(BaseModel):
    id: ModelFileType
    name: str
    description: str
    downloaded: bool
    size: int
    expected_size: int
    required: bool = True
    is_folder: bool = False
    relative_path: str
    resolved_path: str
    optional_reason: str | None = None
    in_inventory: bool = True


class TextEncoderStatus(BaseModel):
    downloaded: bool
    size_bytes: int
    size_gb: float
    expected_size_gb: float


class ModelsStatusResponse(BaseModel):
    models: list[ModelFileStatus]
    all_downloaded: bool
    total_size: int
    downloaded_size: int
    total_size_gb: float
    downloaded_size_gb: float
    models_path: str
    has_api_key: bool
    text_encoder_status: TextEncoderStatus
    use_local_text_encoder: bool


class DownloadProgressResponse(BaseModel):
    status: str
    current_downloading_file: ModelFileType | None
    current_file_progress: float
    total_progress: float
    total_downloaded_bytes: int
    expected_total_bytes: int
    completed_files: set[ModelFileType]
    all_files: set[ModelFileType]
    error: str | None
    speed_bytes_per_sec: float


class SuggestGapPromptResponse(BaseModel):
    status: str = "success"
    suggested_prompt: str


class GenerateVideoResponse(BaseModel):
    status: str
    video_path: str | None = None


class GenerateImageResponse(BaseModel):
    status: str
    image_paths: list[str] | None = None


class CancelResponse(BaseModel):
    status: str
    id: str | None = None


class RetakeResponse(BaseModel):
    status: str
    video_path: str | None = None
    result: JsonObject | None = None


class IcLoraExtractResponse(BaseModel):
    conditioning: str
    original: str
    conditioning_type: Literal["canny", "depth", "pose"]
    frame_time: float


class IcLoraGenerateResponse(BaseModel):
    status: str
    video_path: str | None = None


class ModelDownloadStartResponse(BaseModel):
    status: str
    message: str | None = None
    sessionId: str | None = None


class TextEncoderDownloadResponse(BaseModel):
    status: str
    message: str | None = None
    sessionId: str | None = None


class ModelPreloadResponse(BaseModel):
    status: str
    message: str | None = None


class StatusResponse(BaseModel):
    status: str


def _default_json_object_list() -> list[JsonObject]:
    return []


class LibraryPayload(BaseModel):
    """Opaque persisted project library for self-hosted/web deployments.

    The backend is a dumb store: project and asset shapes are owned by the
    frontend, so entries are kept as arbitrary JSON objects and passed through
    unchanged. ``projects`` holds full projects (name, description, cover image,
    assets, timelines); ``playground_assets`` holds Playground-generated assets.
    """

    model_config = ConfigDict(populate_by_name=True)

    projects: list[JsonObject] = Field(default_factory=_default_json_object_list)
    playground_assets: list[JsonObject] = Field(
        default_factory=_default_json_object_list, alias="playgroundAssets"
    )


class ErrorResponse(BaseModel):
    error: str
    message: str | None = None


# ============================================================
# Request Models
# ============================================================


class GenerateVideoRequest(BaseModel):
    prompt: NonEmptyPrompt
    resolution: str = "512p"
    model: str = "fast"
    cameraMotion: VideoCameraMotion = "none"
    negativePrompt: str = ""
    duration: str = "2"
    fps: str = "24"
    audio: str = "false"
    imagePath: str | None = None
    audioPath: str | None = None
    aspectRatio: Literal["16:9", "9:16"] = "16:9"


class GenerateImageRequest(BaseModel):
    prompt: NonEmptyPrompt
    width: int = 1024
    height: int = 1024
    numSteps: int = 4
    numImages: int = 1


class EnhancePromptRequest(BaseModel):
    prompt: NonEmptyPrompt
    mode: Literal["video", "image"] = "video"


class EnhancePromptResponse(BaseModel):
    status: str
    enhanced_prompt: str


class TestPromptEnhancerRequest(BaseModel):
    baseUrl: str | None = None
    apiKey: str | None = None
    model: str | None = None


class TestPromptEnhancerResponse(BaseModel):
    status: str
    message: str
    model: str | None = None


def _default_model_types() -> set[ModelFileType]:
    return set()


class ModelDownloadRequest(BaseModel):
    modelTypes: set[ModelFileType] = Field(default_factory=_default_model_types)


class RequiredModelsResponse(BaseModel):
    modelTypes: list[ModelFileType]


class SuggestGapPromptRequest(BaseModel):
    beforePrompt: str = ""
    afterPrompt: str = ""
    beforeFrame: str | None = None
    afterFrame: str | None = None
    gapDuration: float = 5
    mode: str = "t2v"
    inputImage: str | None = None


class RetakeRequest(BaseModel):
    video_path: str
    start_time: float
    duration: float
    prompt: str = ""
    mode: str = "replace_audio_and_video"


class IcLoraExtractRequest(BaseModel):
    video_path: str
    conditioning_type: Literal["canny", "depth", "pose"] = "canny"
    frame_time: float = 0


class IcLoraImageInput(BaseModel):
    path: str
    frame: int = 0
    strength: float = 1.0


def _default_ic_lora_images() -> list[IcLoraImageInput]:
    return []


class IcLoraGenerateRequest(BaseModel):
    video_path: str
    adapter_type: Literal["union", "ingredients"] = "union"
    conditioning_type: Literal["canny", "depth", "pose", "reference_sheet"] = "canny"
    prompt: NonEmptyPrompt
    conditioning_strength: float = Field(default=1.0, ge=0.0, le=2.0)
    attention_strength: float = Field(default=1.0, ge=0.0, le=1.0)
    num_inference_steps: int = 30
    cfg_guidance_scale: float = 1.0
    negative_prompt: str = ""
    images: list[IcLoraImageInput] = Field(default_factory=_default_ic_lora_images)
