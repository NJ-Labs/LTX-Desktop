"""Generation lifecycle handler."""

from __future__ import annotations

import logging
import time
from threading import RLock
from typing import TYPE_CHECKING
from typing import Literal

from api_types import CancelResponse, GenerationProgressResponse
from handlers.base import StateHandlerBase, with_state_lock
from state.app_state_types import (
    AppState,
    GenerationCancelled,
    GenerationComplete,
    GenerationError,
    GenerationProgress,
    GenerationRunning,
    GenerationState,
    GpuSlot,
)

if TYPE_CHECKING:
    from runtime_config.runtime_config import RuntimeConfig

logger = logging.getLogger(__name__)
GenerationSlot = Literal["gpu", "api"]


class GenerationHandler(StateHandlerBase):
    def __init__(self, state: AppState, lock: RLock, config: RuntimeConfig) -> None:
        super().__init__(state, lock, config)

    @with_state_lock
    def start_generation(self, generation_id: str) -> None:
        if self._is_pending_cancelled():
            raise RuntimeError("Generation was cancelled")
        if self._running_slot() is not None:
            raise RuntimeError("Generation already in progress")
        if self.state.gpu_slot is None:
            raise RuntimeError("No active GPU pipeline")

        self.state.gpu_slot.generation = GenerationRunning(
            id=generation_id,
            progress=GenerationProgress(phase="", progress=0, current_step=0, total_steps=0, updated_at=time.time()),
        )
        # A device slot now owns the lifecycle; drop the bootstrap marker.
        self.state.pending_generation = None

    @with_state_lock
    def start_api_generation(self, generation_id: str) -> None:
        if self._is_pending_cancelled():
            raise RuntimeError("Generation was cancelled")
        if self._running_slot() is not None:
            raise RuntimeError("Generation already in progress")

        self.state.api_generation = GenerationRunning(
            id=generation_id,
            progress=GenerationProgress(phase="", progress=0, current_step=None, total_steps=None, updated_at=time.time()),
        )
        self.state.pending_generation = None

    @with_state_lock
    def _gpu_generation(self) -> GenerationState | None:
        match self.state.gpu_slot:
            case GpuSlot(generation=generation):
                return generation
            case _:
                return None

    @with_state_lock
    def _running_slot(self) -> GenerationSlot | None:
        if isinstance(self._gpu_generation(), GenerationRunning):
            return "gpu"
        if isinstance(self.state.api_generation, GenerationRunning):
            return "api"
        return None

    @with_state_lock
    def _is_pending_cancelled(self) -> bool:
        return isinstance(self.state.pending_generation, GenerationCancelled)

    @with_state_lock
    def try_reserve_generation(self, generation_id: str) -> bool:
        """Atomically claim the single generation slot for an async request.

        Returns False if a generation is already running or queued. On success a
        ``GenerationRunning`` bootstrap marker is recorded so pollers immediately
        observe a queued generation before a device slot is claimed.
        """
        if self.is_generation_running():
            return False
        # Clear any stale terminal generation so polling reflects the new job.
        match self.state.gpu_slot:
            case GpuSlot(generation=(GenerationComplete() | GenerationError() | GenerationCancelled())):
                self.state.gpu_slot.generation = None
            case _:
                pass
        if isinstance(self.state.api_generation, (GenerationComplete, GenerationError, GenerationCancelled)):
            self.state.api_generation = None
        self.state.pending_generation = GenerationRunning(
            id=generation_id,
            progress=GenerationProgress(
                phase="queued", progress=0, current_step=None, total_steps=None, updated_at=time.time()
            ),
        )
        return True

    @with_state_lock
    def _generation_for_polling(self) -> GenerationState | None:
        gpu_gen = self._gpu_generation()
        api_gen = self.state.api_generation

        for generation_type in (GenerationRunning, GenerationCancelled, GenerationError, GenerationComplete):
            if isinstance(gpu_gen, generation_type):
                return gpu_gen
            if isinstance(api_gen, generation_type):
                return api_gen

        return self.state.pending_generation

    @with_state_lock
    def is_generation_cancelled(self) -> bool:
        if isinstance(self.state.pending_generation, GenerationCancelled):
            return True
        match self.state.gpu_slot:
            case GpuSlot(generation=GenerationCancelled()):
                return True
            case GpuSlot(generation=GenerationRunning()):
                return False
            case _:
                return isinstance(self.state.api_generation, GenerationCancelled)

    @with_state_lock
    def update_progress(
        self,
        phase: str,
        progress: int,
        current_step: int | None = None,
        total_steps: int | None = None,
    ) -> None:
        match self._running_slot():
            case "gpu":
                match self.state.gpu_slot:
                    case GpuSlot(generation=GenerationRunning() as running):
                        running.progress.phase = phase
                        running.progress.progress = progress
                        running.progress.current_step = current_step
                        running.progress.total_steps = total_steps
                        running.progress.updated_at = time.time()
                    case _:
                        return
            case "api":
                match self.state.api_generation:
                    case GenerationRunning() as running:
                        running.progress.phase = phase
                        running.progress.progress = progress
                        running.progress.current_step = current_step
                        running.progress.total_steps = total_steps
                        running.progress.updated_at = time.time()
                    case _:
                        return
            case _:
                return

    @with_state_lock
    def cancel_generation(self) -> CancelResponse:
        match self._running_slot():
            case "gpu":
                match self.state.gpu_slot:
                    case GpuSlot(generation=GenerationRunning(id=generation_id)):
                        cancelled = GenerationCancelled(id=generation_id)
                        self.state.gpu_slot.generation = cancelled
                        self.state.pending_generation = None
                        return CancelResponse(status="cancelling", id=cancelled.id)
                    case _:
                        pass
            case "api":
                match self.state.api_generation:
                    case GenerationRunning(id=generation_id):
                        cancelled = GenerationCancelled(id=generation_id)
                        self.state.api_generation = cancelled
                        self.state.pending_generation = None
                        return CancelResponse(status="cancelling", id=cancelled.id)
                    case _:
                        pass
            case _:
                pass

        # No device slot is running yet — cancel a queued (pending) generation so a
        # user can discard during the model-load / queue phase.
        match self.state.pending_generation:
            case GenerationRunning(id=generation_id):
                self.state.pending_generation = GenerationCancelled(id=generation_id)
                return CancelResponse(status="cancelling", id=generation_id)
            case GenerationCancelled(id=generation_id):
                return CancelResponse(status="cancelling", id=generation_id)
            case _:
                pass

        match self.state.gpu_slot:
            case GpuSlot(generation=GenerationCancelled(id=generation_id)):
                return CancelResponse(status="cancelling", id=generation_id)
            case _:
                pass

        match self.state.api_generation:
            case GenerationCancelled(id=generation_id):
                return CancelResponse(status="cancelling", id=generation_id)
            case _:
                pass

        return CancelResponse(status="no_active_generation")

    @with_state_lock
    def complete_generation(self, result: str | list[str]) -> None:
        match self._running_slot():
            case "gpu":
                match self.state.gpu_slot:
                    case GpuSlot(generation=GenerationRunning(id=generation_id)) as gpu_slot:
                        gpu_slot.generation = GenerationComplete(id=generation_id, result=result)
                        self.state.pending_generation = None
                    case _:
                        return
            case "api":
                match self.state.api_generation:
                    case GenerationRunning(id=generation_id):
                        self.state.api_generation = GenerationComplete(id=generation_id, result=result)
                        self.state.pending_generation = None
                    case _:
                        return
            case _:
                return

    @with_state_lock
    def fail_generation(self, error: str, status_code: int = 500) -> None:
        match self._running_slot():
            case "gpu":
                match self.state.gpu_slot:
                    case GpuSlot(generation=GenerationRunning(id=generation_id)) as gpu_slot:
                        logger.error("Generation %s failed: %s", generation_id, error)
                        gpu_slot.generation = GenerationError(id=generation_id, error=error, status_code=status_code)
                    case _:
                        logger.error("Generation failed without active running job: %s", error)
                self.state.pending_generation = None
                return
            case "api":
                match self.state.api_generation:
                    case GenerationRunning(id=generation_id):
                        logger.error("Generation %s failed: %s", generation_id, error)
                        self.state.api_generation = GenerationError(id=generation_id, error=error, status_code=status_code)
                    case _:
                        logger.error("Generation failed without active running job: %s", error)
                self.state.pending_generation = None
                return
            case _:
                # No device slot is running. If a terminal error was already
                # recorded (e.g. the inner handler raised), refresh it with the
                # caller's message/status — this lets the async wrapper replace a
                # raw error with a normalized one (e.g. GPU out-of-memory tagging).
                gpu_gen = self._gpu_generation()
                api_gen = self.state.api_generation
                if isinstance(gpu_gen, GenerationError):
                    gpu_gen.error = error
                    gpu_gen.status_code = status_code
                    self.state.pending_generation = None
                    return
                if isinstance(api_gen, GenerationError):
                    api_gen.error = error
                    api_gen.status_code = status_code
                    self.state.pending_generation = None
                    return
                # Otherwise record the failure on the queued (pending) marker so
                # async pollers (and the scheduling request) observe the error.
                match self.state.pending_generation:
                    case GenerationRunning(id=generation_id):
                        logger.error("Generation %s failed before start: %s", generation_id, error)
                        self.state.pending_generation = GenerationError(
                            id=generation_id, error=error, status_code=status_code
                        )
                        return
                    case GenerationCancelled():
                        return
                    case _:
                        pass
                if isinstance(gpu_gen, GenerationCancelled) or isinstance(api_gen, GenerationCancelled):
                    return
                logger.error("Generation failed without active running job: %s", error)
                return

    @with_state_lock
    def get_generation_progress(self) -> GenerationProgressResponse:
        gen = self._generation_for_polling()

        match gen:
            case GenerationRunning(progress=progress):
                updated_at = progress.updated_at
                heartbeat_age_ms = int(max(0.0, time.time() - updated_at) * 1000) if updated_at > 0 else None
                return GenerationProgressResponse(
                    status="running",
                    phase=progress.phase,
                    progress=int(progress.progress),
                    currentStep=progress.current_step,
                    totalSteps=progress.total_steps,
                    heartbeatAgeMs=heartbeat_age_ms,
                )
            case GenerationComplete(result=result):
                video_path = result if isinstance(result, str) else None
                image_paths = result if isinstance(result, list) else None
                return GenerationProgressResponse(
                    status="complete",
                    phase="complete",
                    progress=100,
                    currentStep=0,
                    totalSteps=0,
                    videoPath=video_path,
                    imagePaths=image_paths,
                )
            case GenerationCancelled():
                return GenerationProgressResponse(
                    status="cancelled",
                    phase="cancelled",
                    progress=0,
                    currentStep=0,
                    totalSteps=0,
                )
            case GenerationError(error=error):
                return GenerationProgressResponse(
                    status="error",
                    phase="error",
                    progress=0,
                    currentStep=0,
                    totalSteps=0,
                    error=error,
                )
            case _:
                return GenerationProgressResponse(
                    status="idle",
                    phase="",
                    progress=0,
                    currentStep=0,
                    totalSteps=0,
                )

    @with_state_lock
    def get_async_outcome(self) -> tuple[str, str | list[str] | None, int]:
        """Snapshot the current generation outcome for a just-scheduled async job.

        Returns ``(kind, payload, status_code)`` where kind is one of
        ``complete`` (payload = result), ``cancelled``, ``error``
        (payload = message, status_code set), or ``started`` (still running).
        With an inline task runner the job has already finished, so callers can
        return a synchronous result; with a threaded runner it is still running
        and callers return ``started`` for the client to poll.
        """
        gen = self._generation_for_polling()
        match gen:
            case GenerationComplete(result=result):
                return ("complete", result, 200)
            case GenerationCancelled():
                return ("cancelled", None, 200)
            case GenerationError(error=error, status_code=status_code):
                return ("error", error, status_code)
            case _:
                return ("started", None, 202)

    @with_state_lock
    def is_generation_running(self) -> bool:
        if self._running_slot() is not None:
            return True
        return isinstance(self.state.pending_generation, GenerationRunning)
