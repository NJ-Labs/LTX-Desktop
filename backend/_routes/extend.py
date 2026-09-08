"""Route handler for local temporal video extension."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from api_types import ExtendLimitsResponse, ExtendRequest, ExtendResponse
from app_handler import AppHandler
from state import get_state_service

router = APIRouter(prefix="/api", tags=["extend"])


@router.get("/extend/limits", response_model=ExtendLimitsResponse)
def route_extend_limits(
    video_path: str,
    handler: AppHandler = Depends(get_state_service),
) -> ExtendLimitsResponse:
    return handler.extend.get_limits(video_path)


@router.post("/extend", response_model=ExtendResponse)
def route_extend(req: ExtendRequest, handler: AppHandler = Depends(get_state_service)) -> ExtendResponse:
    return handler.extend.run(req)
