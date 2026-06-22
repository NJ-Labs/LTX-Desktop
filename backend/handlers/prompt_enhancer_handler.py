"""Prompt enhancement via a user-configured OpenAI-compatible LLM endpoint.

The endpoint is supplied by the user in Settings -> Prompt Enhancer (base URL,
optional API key and model name). Because the request is issued from the backend
to a user-controlled URL (typically a local server such as LM Studio, Ollama or
vLLM), this feature also works in offline / air-gapped deployments.
"""

from __future__ import annotations

import logging
import re
from threading import RLock
from typing import TYPE_CHECKING

from api_types import (
    EnhancePromptRequest,
    EnhancePromptResponse,
    TestPromptEnhancerRequest,
    TestPromptEnhancerResponse,
)
from _routes._errors import HTTPError
from handlers.base import StateHandlerBase
from pydantic import BaseModel, Field, ValidationError
from services.interfaces import HTTPClient, HttpTimeoutError, JSONValue
from state.app_state_types import AppState

if TYPE_CHECKING:
    from runtime_config.runtime_config import RuntimeConfig

logger = logging.getLogger(__name__)


# Best-practice instructions for LTX-2 (LTX 2.3) text/image-to-video generation.
_VIDEO_SYSTEM_PROMPT = (
    "You are a prompt engineer for the LTX 2.3 (LTXV) text-to-video model. Rewrite the "
    "user's idea into a single, richly detailed cinematic prompt that LTX 2.3 can turn "
    "into a high-quality video clip.\n\n"
    "Follow these LTX best practices:\n"
    "- Write one flowing paragraph (no lists, no headings, no markdown, no quotes).\n"
    "- Describe events chronologically as they unfold over time.\n"
    "- Cover, in order: the main subject and its appearance; the specific action and "
    "motion; the setting and background; then camera framing and movement (e.g. slow "
    "dolly in, tracking shot, handheld, static wide shot); lighting; color palette; and "
    "overall mood and visual style.\n"
    "- Describe concrete, observable motion — LTX rewards explicit movement of both the "
    "subject and the camera.\n"
    "- Be specific and visual; avoid abstract, vague or non-visual wording, and never use "
    "negations (describe what IS present).\n"
    "- Use natural cinematic language (e.g. shallow depth of field, golden-hour light, "
    "volumetric haze) where it helps, but keep it grounded in the user's idea.\n"
    "- Aim for roughly 2-5 sentences. Preserve the user's intent and any key details.\n"
    "- Output ONLY the final enhanced prompt text, nothing else."
)

# Best-practice instructions for the Z-Image-Turbo still-image model.
_IMAGE_SYSTEM_PROMPT = (
    "You are a prompt engineer for the Z-Image-Turbo text-to-image model. Rewrite the "
    "user's idea into a single, vivid prompt that describes one still image in rich "
    "detail.\n\n"
    "Follow these best practices:\n"
    "- Write one flowing paragraph (no lists, no headings, no markdown, no quotes).\n"
    "- Describe a single frozen moment — do NOT use motion, time, camera-movement or "
    "video language.\n"
    "- Cover: the main subject and its appearance; composition and framing; the setting "
    "and background; lighting; color palette; rendering style or medium (e.g. photoreal, "
    "cinematic photograph, illustration, 3D render) with relevant lens or art details; and "
    "overall mood.\n"
    "- Be specific and visual; avoid abstract, vague or non-visual wording, and never use "
    "negations (describe what IS present).\n"
    "- Aim for roughly 2-4 sentences. Preserve the user's intent and any key details.\n"
    "- Output ONLY the final enhanced prompt text, nothing else."
)


class _OpenAIContentPart(BaseModel):
    type: str | None = None
    text: str | None = None


class _OpenAIMessage(BaseModel):
    # Most servers return a plain string, but OpenAI-compatible endpoints may
    # also return a list of typed content parts (e.g. ``[{"type": "text",
    # "text": "..."}]``). Reasoning models additionally expose their chain of
    # thought in ``reasoning_content`` / ``reasoning``.
    content: str | list[_OpenAIContentPart] | None = None
    reasoning_content: str | None = None
    reasoning: str | None = None


class _OpenAIChoice(BaseModel):
    message: _OpenAIMessage


class _OpenAIChatResponse(BaseModel):
    choices: list[_OpenAIChoice] = Field(min_length=1)


class _OpenAIModel(BaseModel):
    id: str | None = None


def _empty_model_list() -> list[_OpenAIModel]:
    return []


class _OpenAIModelsResponse(BaseModel):
    data: list[_OpenAIModel] = Field(default_factory=_empty_model_list)


def _normalize_base_url(base_url: str) -> str:
    return base_url.strip().rstrip("/")


def _chat_completions_url(base_url: str) -> str:
    return f"{_normalize_base_url(base_url)}/chat/completions"


def _models_url(base_url: str) -> str:
    return f"{_normalize_base_url(base_url)}/models"


def _system_prompt_for(mode: str) -> str:
    return _IMAGE_SYSTEM_PROMPT if mode == "image" else _VIDEO_SYSTEM_PROMPT


def _strip_wrapping_quotes(text: str) -> str:
    stripped = text.strip()
    if len(stripped) >= 2 and stripped[0] in {'"', "'", "“", "‘"} and stripped[-1] in {'"', "'", "”", "’"}:
        return stripped[1:-1].strip()
    return stripped


# Reasoning models (DeepSeek-R1, Qwen QwQ, etc.) wrap their chain of thought in
# a leading ``<think>...</think>`` block within the message content. We keep only
# the answer that follows it. A dangling ``<think>`` with no closing tag means the
# whole content is reasoning and should be discarded.
_THINK_BLOCK_RE = re.compile(r"<think\b[^>]*>.*?</think>", re.IGNORECASE | re.DOTALL)
_OPEN_THINK_RE = re.compile(r"<think\b[^>]*>.*\Z", re.IGNORECASE | re.DOTALL)


def _strip_reasoning_blocks(text: str) -> str:
    without_closed = _THINK_BLOCK_RE.sub("", text)
    without_dangling = _OPEN_THINK_RE.sub("", without_closed)
    return without_dangling.strip()


def _message_content_text(message: _OpenAIMessage) -> str:
    content = message.content
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(part.text or "" for part in content)
    return ""


def _extract_openai_text(payload: object) -> str:
    try:
        parsed = _OpenAIChatResponse.model_validate(payload)
    except ValidationError as exc:
        raise HTTPError(502, "PROMPT_ENHANCER_PARSE_ERROR") from exc
    message = parsed.choices[0].message
    content = _strip_reasoning_blocks(_message_content_text(message))
    return _strip_wrapping_quotes(content)


class PromptEnhancerHandler(StateHandlerBase):
    def __init__(self, state: AppState, lock: RLock, config: RuntimeConfig, http: HTTPClient) -> None:
        super().__init__(state, lock, config)
        self._http = http

    def enhance(self, req: EnhancePromptRequest) -> EnhancePromptResponse:
        settings = self.state.app_settings
        base_url = settings.prompt_enhancer_base_url.strip()
        api_key = settings.prompt_enhancer_api_key.strip()
        model = settings.prompt_enhancer_model.strip()

        if not base_url:
            raise HTTPError(400, "PROMPT_ENHANCER_NOT_CONFIGURED")

        messages: list[JSONValue] = [
            {"role": "system", "content": _system_prompt_for(req.mode)},
            {"role": "user", "content": req.prompt},
        ]
        payload: dict[str, JSONValue] = {
            "model": model or "local-model",
            "messages": messages,
            "temperature": 0.7,
            "max_tokens": 16384,
            "stream": False,
        }

        headers = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        try:
            response = self._http.post(
                _chat_completions_url(base_url),
                headers=headers,
                json_payload=payload,
                timeout=60,
            )
        except HttpTimeoutError as exc:
            raise HTTPError(504, "PROMPT_ENHANCER_TIMEOUT") from exc
        except Exception as exc:
            raise HTTPError(502, f"PROMPT_ENHANCER_REQUEST_FAILED: {exc}") from exc

        if response.status_code != 200:
            logger.error("Prompt enhancer error: %s - %s", response.status_code, response.text)
            status = response.status_code if 400 <= response.status_code < 600 else 502
            raise HTTPError(status, f"Prompt enhancer error: {response.text}")

        enhanced = _extract_openai_text(response.json())
        if not enhanced:
            raise HTTPError(502, "PROMPT_ENHANCER_EMPTY_RESPONSE")
        return EnhancePromptResponse(status="success", enhanced_prompt=enhanced)

    def test_connection(self, req: TestPromptEnhancerRequest) -> TestPromptEnhancerResponse:
        settings = self.state.app_settings
        base_url = (req.baseUrl or settings.prompt_enhancer_base_url).strip()
        api_key = (req.apiKey or settings.prompt_enhancer_api_key).strip()
        model = (req.model or settings.prompt_enhancer_model).strip()

        if not base_url:
            raise HTTPError(400, "PROMPT_ENHANCER_NOT_CONFIGURED")

        headers: dict[str, str] = {}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        try:
            response = self._http.get(_models_url(base_url), headers=headers, timeout=15)
        except HttpTimeoutError as exc:
            raise HTTPError(504, "PROMPT_ENHANCER_TIMEOUT") from exc
        except Exception as exc:
            raise HTTPError(502, f"PROMPT_ENHANCER_REQUEST_FAILED: {exc}") from exc

        if response.status_code != 200:
            logger.warning("Prompt enhancer test failed: %s - %s", response.status_code, response.text)
            status = response.status_code if 400 <= response.status_code < 600 else 502
            raise HTTPError(status, f"Prompt enhancer error: {response.text}")

        available = _extract_model_ids(response.json())
        if model and available and model not in available:
            message = f"Connected, but model '{model}' was not found among {len(available)} available model(s)."
        elif available:
            message = f"Connection successful — {len(available)} model(s) available."
        else:
            message = "Connection successful."
        return TestPromptEnhancerResponse(status="success", message=message, model=model or None)


def _extract_model_ids(payload: object) -> list[str]:
    try:
        parsed = _OpenAIModelsResponse.model_validate(payload)
    except ValidationError:
        return []
    return [entry.id for entry in parsed.data if entry.id]
