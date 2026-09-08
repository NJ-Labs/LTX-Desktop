"""Pipeline lifecycle and warmup handler."""

from __future__ import annotations

import logging
from threading import RLock
from typing import TYPE_CHECKING
import uuid

from handlers.base import StateHandlerBase
from handlers.text_handler import TextHandler
from runtime_config.model_download_specs import resolve_model_path
from services.interfaces import (
    A2VPipeline,
    DepthProcessorPipeline,
    FastVideoPipeline,
    ImageGenerationPipeline,
    GpuCleaner,
    IcLoraPipeline,
    PoseProcessorPipeline,
    ProVideoPipeline,
    RetakePipeline,
    VideoPipelineModelType,
)
from services.ltx_pipeline_common import get_quantization_policy_class
from services.services_utils import device_supports_fp8, get_device_type
from state.app_state_types import (
    A2VPipelineState,
    AppState,
    CpuSlot,
    GenerationRunning,
    GpuSlot,
    ICLoraState,
    RetakePipelineState,
    VideoPipelineState,
    VideoPipelineWarmth,
)

if TYPE_CHECKING:
    from runtime_config.runtime_config import RuntimeConfig

logger = logging.getLogger(__name__)


class PipelinesHandler(StateHandlerBase):
    def __init__(
        self,
        state: AppState,
        lock: RLock,
        text_handler: TextHandler,
        gpu_cleaner: GpuCleaner,
        fast_video_pipeline_class: type[FastVideoPipeline],
        pro_video_pipeline_class: type[ProVideoPipeline],
        image_generation_pipeline_class: type[ImageGenerationPipeline],
        ic_lora_pipeline_class: type[IcLoraPipeline],
        depth_processor_pipeline_class: type[DepthProcessorPipeline],
        pose_processor_pipeline_class: type[PoseProcessorPipeline],
        a2v_pipeline_class: type[A2VPipeline],
        retake_pipeline_class: type[RetakePipeline],
        config: RuntimeConfig,
    ) -> None:
        super().__init__(state, lock, config)
        self._text_handler = text_handler
        self._gpu_cleaner = gpu_cleaner
        self._fast_video_pipeline_class = fast_video_pipeline_class
        self._pro_video_pipeline_class = pro_video_pipeline_class
        self._image_generation_pipeline_class = image_generation_pipeline_class
        self._ic_lora_pipeline_class = ic_lora_pipeline_class
        self._depth_processor_pipeline_class = depth_processor_pipeline_class
        self._pose_processor_pipeline_class = pose_processor_pipeline_class
        self._a2v_pipeline_class = a2v_pipeline_class
        self._retake_pipeline_class = retake_pipeline_class
        self._runtime_device = get_device_type(self.config.device)

    def _ensure_no_running_generation(self) -> None:
        match self.state.gpu_slot:
            case GpuSlot(generation=GenerationRunning()):
                raise RuntimeError("Generation already running; cannot swap pipelines")
            case _:
                return

    def _try_reserve_warmup(self, operation_id: str) -> bool:
        with self._lock:
            if self.state.native_run_id is not None or self.state.comfy_run_id is not None:
                return False
            match self.state.gpu_slot:
                case GpuSlot(generation=GenerationRunning()):
                    return False
                case _:
                    pass
            if isinstance(self.state.pending_generation, GenerationRunning):
                return False
            if isinstance(self.state.api_generation, GenerationRunning):
                return False
            self.state.native_run_id = operation_id
            return True

    def _release_warmup(self, operation_id: str) -> None:
        with self._lock:
            if self.state.native_run_id == operation_id:
                self.state.native_run_id = None

    def _pipeline_matches_model_type(self, model_type: VideoPipelineModelType) -> bool:
        match self.state.gpu_slot:
            case GpuSlot(active_pipeline=VideoPipelineState(pipeline=pipeline)):
                if pipeline.pipeline_kind != model_type:
                    return False
                if model_type == "fast":
                    return getattr(pipeline, "use_upscaler", None) == self.state.app_settings.fast_model.use_upscaler
                if model_type == "pro":
                    return getattr(pipeline, "use_upscaler", None) == self.state.app_settings.pro_model.use_upscaler
                return True
            case _:
                return False

    def _assert_invariants(self) -> None:
        gpu_is_zit = False
        match self.state.gpu_slot:
            case GpuSlot(active_pipeline=VideoPipelineState() | ICLoraState() | A2VPipelineState() | RetakePipelineState()):
                gpu_is_zit = False
            case GpuSlot():
                gpu_is_zit = True
            case _:
                gpu_is_zit = False

        if gpu_is_zit and self.state.cpu_slot is not None:
            raise RuntimeError("Invariant violation: ZIT cannot be in both GPU and CPU slots")

    def _install_text_patches_if_needed(self) -> None:
        te = self.state.text_encoder
        if te is None:
            return
        te.service.install_patches(lambda: self.state)

    def _compile_if_enabled(self, state: VideoPipelineState) -> VideoPipelineState:
        if not self.state.app_settings.use_torch_compile:
            return state
        if state.is_compiled:
            return state
        if self._runtime_device == "mps":
            logger.info("Skipping torch.compile() for %s - not supported on MPS", state.pipeline.pipeline_kind)
            return state

        try:
            state.pipeline.compile_transformer()
            state.is_compiled = True
        except Exception as exc:
            logger.warning("Failed to compile transformer: %s", exc, exc_info=True)
        return state

    def _create_video_pipeline(self, model_type: VideoPipelineModelType) -> VideoPipelineState:
        gemma_root = self._text_handler.resolve_gemma_root()

        upsampler_path = str(resolve_model_path(self.models_dir, self.config.model_download_specs,"upsampler"))

        if model_type == "pro":
            return self._create_pro_video_pipeline(gemma_root, upsampler_path)

        checkpoint_path = str(resolve_model_path(self.models_dir, self.config.model_download_specs,"checkpoint"))

        pipeline = self._fast_video_pipeline_class.create(
            checkpoint_path,
            gemma_root,
            upsampler_path,
            self.state.app_settings.fast_model.use_upscaler,
            self.config.device,
        )

        state = VideoPipelineState(
            pipeline=pipeline,
            warmth=VideoPipelineWarmth.COLD,
            is_compiled=False,
        )
        return self._compile_if_enabled(state)

    def _create_pro_video_pipeline(self, gemma_root: str | None, upsampler_path: str) -> VideoPipelineState:
        dev_checkpoint_path = resolve_model_path(self.models_dir, self.config.model_download_specs, "dev_checkpoint")
        distilled_lora_path = resolve_model_path(self.models_dir, self.config.model_download_specs, "distilled_lora_384")

        if not dev_checkpoint_path.exists():
            raise RuntimeError(
                "Pro model not downloaded. Local Pro generation requires the full "
                "LTX-2.3 dev model (ltx-2.3-22b-dev). Download it from the Model Status menu."
            )
        if not distilled_lora_path.exists():
            raise RuntimeError(
                "Pro model LoRA not downloaded. Local Pro generation requires the "
                "distilled LoRA-384 (ltx-2.3-22b-distilled-lora-384). Download it from the Model Status menu."
            )

        use_upscaler = self.state.app_settings.pro_model.use_upscaler
        pipeline = self._pro_video_pipeline_class.create(
            str(dev_checkpoint_path),
            gemma_root,
            upsampler_path,
            str(distilled_lora_path),
            use_upscaler,
            self.config.device,
        )

        state = VideoPipelineState(
            pipeline=pipeline,
            warmth=VideoPipelineWarmth.COLD,
            is_compiled=False,
        )
        return self._compile_if_enabled(state)

    def unload_gpu_pipeline(self) -> None:
        with self._lock:
            self._ensure_no_running_generation()
            self.state.gpu_slot = None
            self._assert_invariants()
        self._gpu_cleaner.cleanup()

    def invalidate_video_pipeline_for_compile_change(self) -> bool:
        """Drop the active video pipeline when its compiled state no longer matches
        the ``use_torch_compile`` setting, so the next load reapplies it.

        Returns ``True`` when a pipeline was dropped. No-op (returns ``False``) when
        no video pipeline is active, a generation is running, or the compiled state
        already matches the current setting.
        """
        with self._lock:
            if self.state.native_run_id is not None or self.state.comfy_run_id is not None:
                return False
            match self.state.gpu_slot:
                case GpuSlot(active_pipeline=VideoPipelineState(), generation=GenerationRunning()):
                    return False
                case GpuSlot(active_pipeline=VideoPipelineState(is_compiled=is_compiled)):
                    if is_compiled == self.state.app_settings.use_torch_compile:
                        return False
                    self.state.gpu_slot = None
                    self._assert_invariants()
                case _:
                    return False
        self._gpu_cleaner.cleanup()
        return True

    def park_zit_on_cpu(self) -> None:
        zit: ImageGenerationPipeline | None = None

        with self._lock:
            if self.state.gpu_slot is None:
                return

            active = self.state.gpu_slot.active_pipeline
            if isinstance(active, (VideoPipelineState, ICLoraState, A2VPipelineState, RetakePipelineState)):
                return

            generation = self.state.gpu_slot.generation
            if isinstance(generation, GenerationRunning):
                raise RuntimeError("Cannot park ZIT while generation is running")

            zit = active
            self.state.gpu_slot = None

        assert zit is not None
        zit.to("cpu")
        self._gpu_cleaner.cleanup()

        with self._lock:
            self.state.cpu_slot = CpuSlot(active_pipeline=zit)
            self._assert_invariants()

    def load_zit_to_gpu(self) -> ImageGenerationPipeline:
        with self._lock:
            if self.state.gpu_slot is not None:
                active = self.state.gpu_slot.active_pipeline
                if not isinstance(active, (VideoPipelineState, ICLoraState, A2VPipelineState, RetakePipelineState)):
                    return active
                self._ensure_no_running_generation()

        zit_service: ImageGenerationPipeline | None = None

        with self._lock:
            match self.state.cpu_slot:
                case CpuSlot(active_pipeline=stored):
                    zit_service = stored
                    self.state.cpu_slot = None
                case _:
                    zit_service = None

        if zit_service is None:
            zit_path = resolve_model_path(self.models_dir, self.config.model_download_specs,"zit")
            if not (zit_path.exists() and any(zit_path.iterdir())):
                raise RuntimeError("Z-Image-Turbo model not downloaded. Please download the AI models first using the Model Status menu.")
            zit_service = self._image_generation_pipeline_class.create(str(zit_path), self._runtime_device)
        else:
            zit_service.to(self._runtime_device)

        self._gpu_cleaner.cleanup()

        with self._lock:
            self.state.gpu_slot = GpuSlot(active_pipeline=zit_service, generation=None)
            self._assert_invariants()

        return zit_service

    def preload_zit_to_cpu(self) -> ImageGenerationPipeline:
        with self._lock:
            match self.state.cpu_slot:
                case CpuSlot(active_pipeline=existing):
                    return existing
                case _:
                    pass

        zit_path = resolve_model_path(self.models_dir, self.config.model_download_specs,"zit")
        if not (zit_path.exists() and any(zit_path.iterdir())):
            raise RuntimeError("Z-Image-Turbo model not downloaded. Please download the AI models first using the Model Status menu.")

        zit_service = self._image_generation_pipeline_class.create(str(zit_path), None)
        with self._lock:
            if self.state.cpu_slot is None:
                self.state.cpu_slot = CpuSlot(active_pipeline=zit_service)
                self._assert_invariants()
                return zit_service
            return self.state.cpu_slot.active_pipeline

    def _evict_gpu_pipeline_for_swap(self) -> None:
        should_park_zit = False
        should_cleanup = False

        with self._lock:
            self._ensure_no_running_generation()
            if self.state.gpu_slot is None:
                return

            active = self.state.gpu_slot.active_pipeline
            if isinstance(active, (VideoPipelineState, ICLoraState, A2VPipelineState, RetakePipelineState)):
                self.state.gpu_slot = None
                self._assert_invariants()
                should_cleanup = True
            else:
                should_park_zit = True

        if should_park_zit:
            self.park_zit_on_cpu()
        elif should_cleanup:
            self._gpu_cleaner.cleanup()

    def load_gpu_pipeline(self, model_type: VideoPipelineModelType, should_warm: bool = False) -> VideoPipelineState:
        self._install_text_patches_if_needed()

        state: VideoPipelineState | None = None
        with self._lock:
            if self._pipeline_matches_model_type(model_type):
                match self.state.gpu_slot:
                    case GpuSlot(active_pipeline=VideoPipelineState() as existing_state):
                        state = existing_state
                    case _:
                        pass

        if state is None:
            self._evict_gpu_pipeline_for_swap()
            state = self._create_video_pipeline(model_type)
            with self._lock:
                self.state.gpu_slot = GpuSlot(active_pipeline=state, generation=None)
                self._assert_invariants()

        if should_warm and state.warmth == VideoPipelineWarmth.COLD:
            with self._lock:
                state.warmth = VideoPipelineWarmth.WARMING

            self.warmup_pipeline(model_type)
            with self._lock:
                if state.warmth == VideoPipelineWarmth.WARMING:
                    state.warmth = VideoPipelineWarmth.WARM

        return state

    def load_ic_lora(
        self,
        lora_path: str,
        depth_model_path: str | None = None,
        person_detector_model_path: str | None = None,
        pose_model_path: str | None = None,
        lora_strength: float = 1.0,
    ) -> ICLoraState:
        self._install_text_patches_if_needed()

        with self._lock:
            match self.state.gpu_slot:
                case GpuSlot(
                    active_pipeline=ICLoraState(
                        lora_path=current_lora_path,
                        lora_strength=current_lora_strength,
                        depth_model_path=current_depth_model_path,
                        person_detector_model_path=current_person_detector_model_path,
                        pose_model_path=current_pose_model_path,
                    ) as state
                ) if (
                    current_lora_path == lora_path
                    and current_lora_strength == lora_strength
                    and current_depth_model_path == depth_model_path
                    and current_person_detector_model_path == person_detector_model_path
                    and current_pose_model_path == pose_model_path
                ):
                    return state
                case _:
                    pass

        self._evict_gpu_pipeline_for_swap()

        pipeline = self._ic_lora_pipeline_class.create(
            str(resolve_model_path(self.models_dir, self.config.model_download_specs,"checkpoint")),
            self._text_handler.resolve_gemma_root(),
            str(resolve_model_path(self.models_dir, self.config.model_download_specs,"upsampler")),
            lora_path,
            lora_strength,
            self.config.device,
        )
        depth_pipeline = None
        if depth_model_path is not None:
            depth_pipeline = self._depth_processor_pipeline_class.create(depth_model_path, self.config.device)

        if (person_detector_model_path is None) != (pose_model_path is None):
            raise ValueError("Pose preprocessing requires both detector and pose model paths")
        pose_pipeline = None
        if person_detector_model_path is not None and pose_model_path is not None:
            pose_pipeline = self._pose_processor_pipeline_class.create(
                pose_model_path,
                person_detector_model_path,
                self.config.device,
            )
        state = ICLoraState(
            pipeline=pipeline,
            lora_path=lora_path,
            lora_strength=lora_strength,
            depth_pipeline=depth_pipeline,
            depth_model_path=depth_model_path,
            pose_pipeline=pose_pipeline,
            person_detector_model_path=person_detector_model_path,
            pose_model_path=pose_model_path,
        )

        with self._lock:
            self.state.gpu_slot = GpuSlot(active_pipeline=state, generation=None)
            self._assert_invariants()
        return state

    def load_a2v_pipeline(self) -> A2VPipelineState:
        self._install_text_patches_if_needed()

        with self._lock:
            match self.state.gpu_slot:
                case GpuSlot(active_pipeline=A2VPipelineState() as state):
                    return state
                case _:
                    pass

        self._evict_gpu_pipeline_for_swap()

        pipeline = self._a2v_pipeline_class.create(
            str(resolve_model_path(self.models_dir, self.config.model_download_specs,"checkpoint")),
            self._text_handler.resolve_gemma_root(),
            str(resolve_model_path(self.models_dir, self.config.model_download_specs,"upsampler")),
            self.config.device,
        )
        state = A2VPipelineState(pipeline=pipeline)

        with self._lock:
            self.state.gpu_slot = GpuSlot(active_pipeline=state, generation=None)
            self._assert_invariants()
        return state

    def load_retake_pipeline(self, *, distilled: bool = True) -> RetakePipelineState:
        self._install_text_patches_if_needed()

        quantized = device_supports_fp8(self.config.device)

        with self._lock:
            match self.state.gpu_slot:
                case GpuSlot(
                    active_pipeline=RetakePipelineState(distilled=current_distilled, quantized=current_quantized) as state
                ) if current_distilled == distilled and current_quantized == quantized:
                    return state
                case _:
                    pass

        self._evict_gpu_pipeline_for_swap()

        QuantizationPolicy = get_quantization_policy_class()
        quantization = QuantizationPolicy.fp8_cast() if quantized else None
        pipeline = self._retake_pipeline_class.create(
            checkpoint_path=str(resolve_model_path(self.models_dir, self.config.model_download_specs,"checkpoint")),
            gemma_root=self._text_handler.resolve_gemma_root(),
            device=self.config.device,
            loras=[],
            quantization=quantization,
        )
        state = RetakePipelineState(pipeline=pipeline, distilled=distilled, quantized=quantized)

        with self._lock:
            self.state.gpu_slot = GpuSlot(active_pipeline=state, generation=None)
            self._assert_invariants()
        return state

    def warmup_pipeline(self, model_type: VideoPipelineModelType) -> None:
        operation_id = f"warmup-{uuid.uuid4().hex[:8]}"
        if not self._try_reserve_warmup(operation_id):
            raise RuntimeError("GPU is busy; cannot warm a pipeline")
        try:
            state = self.load_gpu_pipeline(model_type, should_warm=False)
            warmup_path = self.config.outputs_dir / f"_warmup_{model_type}.mp4"
            state.pipeline.warmup(output_path=str(warmup_path))
        finally:
            self._release_warmup(operation_id)
