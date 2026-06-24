"""Routes for /api/prompt-enhancer (local OpenAI-compatible LLM)."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from api_types import (
    EnhancePromptRequest,
    EnhancePromptResponse,
    TestPromptEnhancerRequest,
    TestPromptEnhancerResponse,
)
from state import get_state_service
from app_handler import AppHandler

router = APIRouter(prefix="/api/prompt-enhancer", tags=["prompt"])


@router.post("/enhance", response_model=EnhancePromptResponse)
def route_enhance_prompt(
    req: EnhancePromptRequest,
    handler: AppHandler = Depends(get_state_service),
) -> EnhancePromptResponse:
    return handler.prompt_enhancer.enhance(req)


@router.post("/enhance/stream")
def route_enhance_prompt_stream(
    req: EnhancePromptRequest,
    handler: AppHandler = Depends(get_state_service),
) -> StreamingResponse:
    chunks = handler.prompt_enhancer.enhance_stream(req)
    return StreamingResponse(chunks, media_type="application/x-ndjson")


@router.post("/test", response_model=TestPromptEnhancerResponse)
def route_test_prompt_enhancer(
    req: TestPromptEnhancerRequest,
    handler: AppHandler = Depends(get_state_service),
) -> TestPromptEnhancerResponse:
    return handler.prompt_enhancer.test_connection(req)
