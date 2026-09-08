"""Image generation orchestration handler."""

from __future__ import annotations

import logging
import time
import uuid
from datetime import datetime
from pathlib import Path
from threading import RLock
from typing import TYPE_CHECKING

from PIL import Image, ImageOps

from _routes._errors import HTTPError
from api_types import GenerateImageRequest, GenerateImageResponse
from handlers.base import StateHandlerBase
from handlers.generation_handler import GenerationHandler
from handlers.pipelines_handler import PipelinesHandler
from server_utils.gpu_errors import normalize_generation_error
from server_utils.media_validation import normalize_optional_path, validate_image_file
from services.interfaces import TaskRunner, ZitAPIClient
from state.app_state_types import AppState

if TYPE_CHECKING:
    from runtime_config.runtime_config import RuntimeConfig

logger = logging.getLogger(__name__)


class ImageGenerationHandler(StateHandlerBase):
    def __init__(
        self,
        state: AppState,
        lock: RLock,
        generation_handler: GenerationHandler,
        pipelines_handler: PipelinesHandler,
        config: RuntimeConfig,
        zit_api_client: ZitAPIClient,
        task_runner: TaskRunner,
    ) -> None:
        super().__init__(state, lock, config)
        self._generation = generation_handler
        self._pipelines = pipelines_handler
        self._zit_api_client = zit_api_client
        self._task_runner = task_runner

    def generate_async(self, req: GenerateImageRequest) -> GenerateImageResponse:
        """Non-blocking image generation entry point. See
        ``VideoGenerationHandler.generate_async`` for the rationale.
        """
        generation_id = uuid.uuid4().hex[:8]
        if not self._generation.try_reserve_generation(generation_id):
            raise HTTPError(409, "Generation already in progress")

        try:
            self._task_runner.run_background(
                lambda: self._run_generation(req, generation_id),
                task_name="image-generation",
            )
        except Exception:
            self._generation.release_generation(generation_id)
            raise

        kind, payload, status_code = self._generation.get_async_outcome()
        if kind == "complete":
            return GenerateImageResponse(status="complete", image_paths=payload if isinstance(payload, list) else None)
        if kind == "cancelled":
            return GenerateImageResponse(status="cancelled")
        if kind == "error":
            raise HTTPError(status_code, str(payload) if payload else "Image generation failed")
        return GenerateImageResponse(status="started")

    def _run_generation(self, req: GenerateImageRequest, generation_id: str) -> None:
        try:
            self.generate(req)
        except HTTPError as exc:
            self._generation.fail_generation(normalize_generation_error(exc.detail), status_code=exc.status_code)
        except Exception as exc:  # noqa: BLE001 - surface failure to async pollers
            self._generation.fail_generation(normalize_generation_error(exc))
        finally:
            self._generation.release_generation(generation_id)

    def generate(self, req: GenerateImageRequest) -> GenerateImageResponse:
        if self._generation.is_generation_cancelled():
            raise RuntimeError("Generation was cancelled")

        width = (req.width // 16) * 16
        height = (req.height // 16) * 16
        num_images = max(1, min(12, req.numImages))
        source_image_path = normalize_optional_path(req.imagePath)
        source_image: Image.Image | None = None
        if source_image_path is not None:
            if int(req.numSteps * req.strength) < 1:
                raise HTTPError(400, "Image edit strength and steps must produce at least one denoising step")
            validated_path = validate_image_file(source_image_path)
            try:
                with Image.open(validated_path) as opened:
                    source_image = ImageOps.fit(
                        opened.convert("RGB"),
                        (width, height),
                        method=Image.Resampling.LANCZOS,
                    )
            except Exception:
                raise HTTPError(400, f"Invalid image file: {source_image_path}") from None

        generation_id = uuid.uuid4().hex[:8]
        settings = self.state.app_settings.model_copy(deep=True)
        if settings.seed_locked:
            seed = settings.locked_seed
            logger.info("Using locked seed for image: %s", seed)
        else:
            seed = int(time.time()) % 2147483647

        if self.config.force_api_generations and not self.config.offline_mode:
            if source_image is not None:
                raise HTTPError(400, "FAL_IMAGE_EDIT_UNSUPPORTED")
            return self._generate_via_api(
                prompt=req.prompt,
                width=width,
                height=height,
                num_inference_steps=req.numSteps,
                seed=seed,
                num_images=num_images,
            )

        try:
            self._pipelines.load_zit_to_gpu()
            self._generation.start_generation(generation_id)
            output_paths = self.generate_image(
                prompt=req.prompt,
                width=width,
                height=height,
                num_inference_steps=req.numSteps,
                seed=seed,
                num_images=num_images,
                source_image=source_image,
                strength=req.strength,
            )
            self._generation.complete_generation(output_paths)
            return GenerateImageResponse(status="complete", image_paths=output_paths)
        except Exception as e:
            if "cancelled" in str(e).lower():
                self._generation.cancel_generation()
                logger.info("Image generation cancelled by user")
                return GenerateImageResponse(status="cancelled")
            self._generation.fail_generation(str(e))
            raise HTTPError(500, str(e)) from e

    def generate_image(
        self,
        prompt: str,
        width: int,
        height: int,
        num_inference_steps: int,
        seed: int | None,
        num_images: int,
        source_image: Image.Image | None = None,
        strength: float = 0.6,
    ) -> list[str]:
        if self._generation.is_generation_cancelled():
            raise RuntimeError("Generation was cancelled")

        self._generation.update_progress("loading_model", 5, 0, num_inference_steps)
        zit = self._pipelines.load_zit_to_gpu()
        self._generation.update_progress("inference", 15, 0, num_inference_steps)

        if seed is None:
            seed = int(time.time()) % 2147483647

        outputs: list[str] = []
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

        try:
            for i in range(num_images):
                if self._generation.is_generation_cancelled():
                    raise RuntimeError("Generation was cancelled")

                progress = 15 + int((i / num_images) * 80)
                self._generation.update_progress("inference", progress, i, num_images)

                if source_image is None:
                    result = zit.generate(
                        prompt=prompt,
                        height=height,
                        width=width,
                        guidance_scale=0.0,
                        num_inference_steps=num_inference_steps,
                        seed=seed + i,
                    )
                else:
                    result = zit.edit(
                        prompt=prompt,
                        image=source_image,
                        strength=strength,
                        num_inference_steps=num_inference_steps,
                        seed=seed + i,
                    )

                if self._generation.is_generation_cancelled():
                    raise RuntimeError("Generation was cancelled")

                output_path = self.config.outputs_dir / f"zit_image_{timestamp}_{uuid.uuid4().hex[:8]}.png"
                outputs.append(str(output_path))
                result.images[0].save(str(output_path))
        except Exception:
            for output in outputs:
                Path(output).unlink(missing_ok=True)
            raise

        if self._generation.is_generation_cancelled():
            raise RuntimeError("Generation was cancelled")

        self._generation.update_progress("complete", 100, num_images, num_images)
        return outputs

    def _generate_via_api(
        self,
        *,
        prompt: str,
        width: int,
        height: int,
        num_inference_steps: int,
        seed: int,
        num_images: int,
    ) -> GenerateImageResponse:
        generation_id = uuid.uuid4().hex[:8]
        output_paths: list[Path] = []
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        settings = self.state.app_settings.model_copy(deep=True)

        try:
            self._generation.start_api_generation(generation_id)
            self._generation.update_progress("validating_request", 5, None, None)

            if not settings.fal_api_key.strip():
                raise HTTPError(500, "FAL_API_KEY_NOT_CONFIGURED")

            for idx in range(num_images):
                if self._generation.is_generation_cancelled():
                    raise RuntimeError("Generation was cancelled")

                inference_progress = 15 + int((idx / num_images) * 60)
                self._generation.update_progress("inference", inference_progress, None, None)
                image_bytes = self._zit_api_client.generate_text_to_image(
                    api_key=settings.fal_api_key,
                    prompt=prompt,
                    width=width,
                    height=height,
                    seed=seed + idx,
                    num_inference_steps=num_inference_steps,
                    base_url=settings.fal_api_base_url,
                )

                if self._generation.is_generation_cancelled():
                    raise RuntimeError("Generation was cancelled")

                download_progress = 75 + int(((idx + 1) / num_images) * 20)
                self._generation.update_progress("downloading_output", download_progress, None, None)

                output_path = self.config.outputs_dir / f"zit_api_image_{timestamp}_{uuid.uuid4().hex[:8]}.png"
                output_path.write_bytes(image_bytes)
                output_paths.append(output_path)

            self._generation.update_progress("complete", 100, None, None)
            self._generation.complete_generation([str(path) for path in output_paths])
            return GenerateImageResponse(status="complete", image_paths=[str(path) for path in output_paths])
        except HTTPError as e:
            self._generation.fail_generation(e.detail, status_code=e.status_code)
            raise
        except Exception as e:
            if "cancelled" in str(e).lower():
                self._generation.cancel_generation()
                for path in output_paths:
                    path.unlink(missing_ok=True)
                logger.info("Image generation cancelled by user")
                return GenerateImageResponse(status="cancelled")
            self._generation.fail_generation(str(e))
            raise HTTPError(500, str(e)) from e
