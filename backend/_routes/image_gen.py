"""Route handlers for /api/generate-image."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from api_types import GenerateImageRequest, GenerateImageResponse
from state import get_state_service
from app_handler import AppHandler

router = APIRouter(prefix="/api", tags=["image"])


@router.post("/generate-image", response_model=GenerateImageResponse)
def route_generate_image(
    req: GenerateImageRequest,
    handler: AppHandler = Depends(get_state_service),
) -> GenerateImageResponse:
    """POST /api/generate-image.

    Non-blocking: schedules generation in the background and returns immediately
    so long generations cannot trip a reverse-proxy 504. The client polls
    /api/generation/progress for completion and the result.
    """
    return handler.image_generation.generate_async(req)

