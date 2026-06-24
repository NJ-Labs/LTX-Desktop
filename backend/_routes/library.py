"""Route handlers for GET/PUT /api/library (persistent project storage)."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends

from api_types import LibraryPayload, StatusResponse
from state import get_state_service
from app_handler import AppHandler

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["library"])


@router.get("/library", response_model=LibraryPayload)
def route_get_library(handler: AppHandler = Depends(get_state_service)) -> LibraryPayload:
    return handler.library.load_library()


@router.put("/library", response_model=StatusResponse)
def route_put_library(
    payload: LibraryPayload,
    handler: AppHandler = Depends(get_state_service),
) -> StatusResponse:
    handler.library.save_library(payload)
    logger.info(
        "Saved project library (projects=%d, playground_assets=%d)",
        len(payload.projects),
        len(payload.playground_assets),
    )
    return StatusResponse(status="ok")
