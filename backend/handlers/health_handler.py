"""Health and startup lifecycle handler."""

from __future__ import annotations

from threading import RLock
from typing import TYPE_CHECKING

from api_types import GpuInfoResponse, GpuTelemetry, HealthResponse, ModelStatusItem
from handlers.base import StateHandlerBase, with_state_lock
from handlers.models_handler import ModelsHandler
from runtime_config.model_download_specs import resolve_model_path
from handlers.pipelines_handler import PipelinesHandler
from logging_policy import log_background_exception
from services.interfaces import GpuInfo
from state.app_state_types import AppState, GpuSlot, StartupError, StartupLoading, StartupPending, StartupReady, VideoPipelineState, VideoPipelineWarmth

if TYPE_CHECKING:
    from runtime_config.runtime_config import RuntimeConfig


class HealthHandler(StateHandlerBase):
    def __init__(
        self,
        state: AppState,
        lock: RLock,
        models_handler: ModelsHandler,
        pipelines_handler: PipelinesHandler,
        gpu_info: GpuInfo,
        config: RuntimeConfig,
    ) -> None:
        super().__init__(state, lock, config)
        self._models = models_handler
        self._pipelines = pipelines_handler
        self._gpu_info = gpu_info

    def get_health(self) -> HealthResponse:
        active_model: str | None = None
        models_loaded = False

        with self._lock:
            match self.state.gpu_slot:
                case GpuSlot(active_pipeline=VideoPipelineState(pipeline=pipeline)):
                    active_model = pipeline.pipeline_kind
                    models_loaded = True
                case _:
                    pass

        files = self._models.refresh_available_files()

        return HealthResponse(
            status="ok",
            models_loaded=models_loaded,
            active_model=active_model,
            gpu_info=GpuTelemetry(**self._gpu_info.get_gpu_info()),
            sage_attention=self.config.use_sage_attention,
            models_status=[
                ModelStatusItem(
                    id="fast",
                    name="LTX-2 Fast (Distilled)",
                    loaded=models_loaded,
                    downloaded=files["checkpoint"] is not None,
                ),
            ],
        )

    def get_gpu_info(self) -> GpuInfoResponse:
        return GpuInfoResponse(
            cuda_available=self._gpu_info.get_cuda_available(),
            mps_available=self._gpu_info.get_mps_available(),
            gpu_available=self._gpu_info.get_gpu_available(),
            gpu_name=self._gpu_info.get_device_name(),
            vram_gb=self._gpu_info.get_vram_total_gb(),
            gpu_info=GpuTelemetry(**self._gpu_info.get_gpu_info()),
        )

    @with_state_lock
    def set_startup_pending(self, message: str) -> None:
        self.state.startup = StartupPending(message=message)

    @with_state_lock
    def set_startup_loading(self, step: str, progress: float) -> None:
        self.state.startup = StartupLoading(current_step=step, progress=progress)

    @with_state_lock
    def set_startup_ready(self) -> None:
        self.state.startup = StartupReady()

    @with_state_lock
    def set_startup_error(self, error: str) -> None:
        self.state.startup = StartupError(error=error)

    def get_startup_probe(self) -> tuple[bool, dict[str, object]]:
        with self._lock:
            startup = self.state.startup

        match startup:
            case StartupReady():
                return True, {"status": "ready"}
            case StartupLoading(current_step=step, progress=progress):
                return False, {
                    "status": "loading",
                    "current_step": step,
                    "progress": progress,
                }
            case StartupPending(message=message):
                return False, {"status": "pending", "message": message}
            case StartupError(error=error):
                return False, {"status": "error", "error": error}

        return False, {"status": "unknown"}

    def default_warmup(self) -> None:
        try:
            if self.config.require_local_mode and self.config.force_api_generations:
                raise RuntimeError(
                    "Local model serving is required, but this runtime was downgraded to API mode on the current hardware."
                )

            self.set_startup_loading("Checking models", 5)
            status = self._models.get_models_status()
            if not status.all_downloaded:
                missing_required = [model.id for model in status.models if model.required and not model.downloaded]
                if self.config.require_local_mode:
                    raise RuntimeError(
                        "Required models are missing from the mounted models directory: "
                        + ", ".join(missing_required)
                    )
                self.set_startup_pending("Models not downloaded. User needs to download via app.")
                return

            should_preload = self.config.startup_preload_models or self.state.app_settings.load_on_startup
            if not should_preload:
                self.set_startup_ready()
                return

            if self.config.force_api_generations:
                self.set_startup_ready()
                return

            self.set_startup_loading("Loading Fast pipeline", 30)
            self._pipelines.load_gpu_pipeline("fast", should_warm=False)

            self.set_startup_loading("Warming Fast pipeline", 60)
            self._pipelines.warmup_pipeline("fast")
            with self._lock:
                match self.state.gpu_slot:
                    case GpuSlot(active_pipeline=VideoPipelineState() as state):
                        state.warmth = VideoPipelineWarmth.WARM
                    case _:
                        pass

            zit_models_path = resolve_model_path(self.models_dir, self.config.model_download_specs,"zit")
            zit_exists = zit_models_path.exists() and any(zit_models_path.iterdir())
            if zit_exists:
                self.set_startup_loading("Preloading Z-Image-Turbo to CPU", 85)
                if self.state.cpu_slot is None:
                    self._pipelines.preload_zit_to_cpu()

            self.set_startup_ready()
        except Exception as exc:
            log_background_exception("health-default-warmup", exc)
            self.set_startup_error(str(exc))
