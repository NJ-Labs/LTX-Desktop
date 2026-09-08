"""Local temporal video extension orchestration."""

from __future__ import annotations

import time
import uuid
from datetime import datetime
from pathlib import Path
from threading import RLock
from typing import TYPE_CHECKING

from _routes._errors import HTTPError
from api_types import ExtendLimitsResponse, ExtendRequest, ExtendResponse
from handlers.base import StateHandlerBase
from handlers.generation_handler import GenerationHandler
from handlers.pipelines_handler import PipelinesHandler
from handlers.text_handler import TextHandler
from runtime_config.ltx_compatibility import supports_local_feature
from state.app_settings import should_video_generate_with_ltx_api
from state.app_state_types import AppState

if TYPE_CHECKING:
    from runtime_config.runtime_config import RuntimeConfig


class ExtendHandler(StateHandlerBase):
    def __init__(
        self,
        state: AppState,
        lock: RLock,
        generation_handler: GenerationHandler,
        pipelines_handler: PipelinesHandler,
        text_handler: TextHandler,
        config: RuntimeConfig,
    ) -> None:
        super().__init__(state, lock, config)
        self._generation = generation_handler
        self._pipelines = pipelines_handler
        self._text = text_handler

    def run(self, req: ExtendRequest) -> ExtendResponse:
        source = self._validate_source_path(req.video_path)
        if should_video_generate_with_ltx_api(
            force_api_generations=self.config.force_api_generations,
            settings=self.state.app_settings,
            allow_remote_services=not self.config.offline_mode,
        ):
            raise HTTPError(409, "LOCAL_EXTEND_REQUIRES_LOCAL_GENERATION")
        if not supports_local_feature("ltx-2.3-22b-distilled", "extend"):
            raise HTTPError(409, "UNSUPPORTED_EXTEND")

        limits = self.get_limits(req.video_path)
        fps = limits.fps
        corrected_source_frames = limits.corrected_source_frames
        extend_frames = self._duration_to_extend_frames(req.duration, fps)
        max_total_frames = ((20 * round(fps)) // 8) * 8 + 1
        if corrected_source_frames + extend_frames > max_total_frames:
            raise HTTPError(400, "Extended clip must be at most 20 seconds total")
        generation_id = uuid.uuid4().hex[:8]
        if not self._generation.try_reserve_generation(generation_id):
            raise HTTPError(409, "Generation already in progress")

        output_path = self.config.outputs_dir / (
            f"extend_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{generation_id}.mp4"
        )
        try:
            try:
                self._text.prepare_text_encoding(req.prompt, enhance_prompt=False)
            except RuntimeError as exc:
                raise HTTPError(400, str(exc)) from exc
            pipeline_state = self._pipelines.load_retake_pipeline(distilled=True)
            self._generation.start_generation(generation_id)
            self._generation.update_progress("inference", 15, 0, 1)
            pipeline_state.pipeline.extend(
                video_path=str(source),
                prompt=req.prompt,
                extend_frames=extend_frames,
                mode=req.mode,
                seed=self._resolve_seed(),
                output_path=str(output_path),
                negative_prompt=self.config.default_negative_prompt,
                regenerate_audio=True,
                enhance_prompt=False,
                distilled=True,
                target_frames=corrected_source_frames,
            )
            if self._generation.is_generation_cancelled():
                output_path.unlink(missing_ok=True)
                raise RuntimeError("Generation was cancelled")
            self._generation.update_progress("complete", 100, 1, 1)
            self._generation.complete_generation(str(output_path))
            return ExtendResponse(status="complete", video_path=str(output_path))
        except HTTPError:
            output_path.unlink(missing_ok=True)
            self._generation.fail_generation("Extend generation failed")
            raise
        except Exception as exc:
            output_path.unlink(missing_ok=True)
            self._generation.fail_generation(str(exc))
            if self._generation.is_generation_cancelled() or "cancelled" in str(exc).lower():
                return ExtendResponse(status="cancelled")
            raise HTTPError(500, f"Generation error: {exc}") from exc
        finally:
            self._text.clear_api_embeddings()
            self._generation.release_generation(generation_id)

    def get_limits(self, video_path: str) -> ExtendLimitsResponse:
        source = self._validate_source_path(video_path)
        fps, source_frames, width, height = self._read_source_metadata(str(source))
        if abs(fps - round(fps)) > 0.01:
            raise HTTPError(400, f"Extend requires an integer source FPS. Got {fps:.3f}.")
        if width % 32 != 0 or height % 32 != 0:
            raise HTTPError(400, f"Video width and height must be multiples of 32. Got {width}x{height}.")

        corrected_source_frames = ((source_frames - 1) // 8) * 8 + 1
        max_total_frames = ((20 * round(fps)) // 8) * 8 + 1
        remaining_frames = max(0, max_total_frames - corrected_source_frames)
        minimum_frames = self._duration_to_extend_frames(2.0, fps)
        return ExtendLimitsResponse(
            fps=fps,
            source_frames=source_frames,
            corrected_source_frames=corrected_source_frames,
            max_additional_seconds=remaining_frames / fps,
            can_extend=remaining_frames >= minimum_frames,
        )

    def _resolve_seed(self) -> int:
        settings = self.state.app_settings
        return settings.locked_seed if settings.seed_locked else int(time.time()) % 2147483647

    @staticmethod
    def _validate_source_path(video_path: str) -> Path:
        source = Path(video_path)
        if not source.is_file():
            raise HTTPError(400, f"Video file not found: {video_path}")
        return source

    @staticmethod
    def _read_source_metadata(video_path: str) -> tuple[float, int, int, int]:
        from ltx_pipelines.utils.media_io import get_videostream_metadata

        try:
            fps, frames, width, height = get_videostream_metadata(video_path)
        except Exception as exc:
            raise HTTPError(400, f"Could not read source video metadata: {exc}") from exc
        if fps <= 0 or frames <= 0 or width <= 0 or height <= 0:
            raise HTTPError(400, "Video has invalid metadata")
        return float(fps), int(frames), int(width), int(height)

    @staticmethod
    def _duration_to_extend_frames(duration: float, fps: float) -> int:
        frames = round(duration * fps)
        return ((frames + 7) // 8) * 8
