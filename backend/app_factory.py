"""FastAPI app factory decoupled from runtime bootstrap side effects."""

from __future__ import annotations

import base64
import hmac
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import TYPE_CHECKING
from urllib.parse import quote

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from starlette.responses import Response as StarletteResponse

from _routes._errors import HTTPError
from _routes.generation import router as generation_router
from _routes.health import router as health_router
from _routes.ic_lora import router as ic_lora_router
from _routes.image_gen import router as image_gen_router
from _routes.library import router as library_router
from _routes.comfyui import init_comfyui_service, router as comfyui_router
from _routes.models import router as models_router
from _routes.prompt_enhancer import router as prompt_enhancer_router
from _routes.suggest_gap_prompt import router as suggest_gap_prompt_router
from _routes.retake import router as retake_router
from _routes.runtime_policy import router as runtime_policy_router
from _routes.settings import router as settings_router
from logging_policy import log_http_error, log_unhandled_exception
from state import init_state_service

if TYPE_CHECKING:
    from app_handler import AppHandler
    from services.comfyui_service import ComfyUIService

DEFAULT_ALLOWED_ORIGINS: list[str] = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]


def create_app(
    *,
    handler: "AppHandler",
    allowed_origins: list[str] | None = None,
    title: str = "LTX-2 Video Generation Server",
    auth_token: str = "",
    admin_token: str = "",
    static_dir: Path | None = None,
    media_roots: list[Path] | None = None,
    media_upload_root: Path | None = None,
    comfyui_service: "ComfyUIService | None" = None,
) -> FastAPI:
    """Create a configured FastAPI app bound to the provided handler."""
    init_state_service(handler)
    init_comfyui_service(comfyui_service)

    serve_frontend = static_dir is not None and static_dir.exists()

    app = FastAPI(
        title=title,
        docs_url=None if serve_frontend else "/docs",
        redoc_url=None if serve_frontend else "/redoc",
        openapi_url=None if serve_frontend else "/openapi.json",
    )
    app.state.admin_token = admin_token  # type: ignore[attr-defined]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins or DEFAULT_ALLOWED_ORIGINS,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def _auth_middleware(  # pyright: ignore[reportUnusedFunction]
        request: Request,
        call_next: Callable[[Request], Awaitable[StarletteResponse]],
    ) -> StarletteResponse:
        if not auth_token:
            return await call_next(request)
        if request.method == "OPTIONS":
            return await call_next(request)
        def _token_matches(candidate: str) -> bool:
            return hmac.compare_digest(candidate, auth_token)

        # WebSocket: check query param
        if request.headers.get("upgrade", "").lower() == "websocket":
            if _token_matches(request.query_params.get("token", "")):
                return await call_next(request)
            return JSONResponse(status_code=401, content={"error": "Unauthorized"})
        # HTTP: Bearer or Basic auth
        auth_header = request.headers.get("authorization", "")
        if auth_header.startswith("Bearer ") and _token_matches(auth_header[7:]):
            return await call_next(request)
        if auth_header.startswith("Basic "):
            try:
                decoded = base64.b64decode(auth_header[6:]).decode()
                _, _, password = decoded.partition(":")
                if _token_matches(password):
                    return await call_next(request)
            except Exception:
                pass
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})

    _FALLBACK = "An unexpected error occurred"

    async def _route_http_error_handler(request: Request, exc: Exception) -> JSONResponse:
        if isinstance(exc, HTTPError):
            log_http_error(request, exc)
            return JSONResponse(status_code=exc.status_code, content={"error": exc.detail or _FALLBACK})
        return JSONResponse(status_code=500, content={"error": str(exc) or _FALLBACK})

    async def _validation_error_handler(request: Request, exc: Exception) -> JSONResponse:
        if isinstance(exc, RequestValidationError):
            return JSONResponse(status_code=422, content={"error": str(exc) or _FALLBACK})
        return JSONResponse(status_code=422, content={"error": str(exc) or _FALLBACK})

    async def _route_generic_error_handler(request: Request, exc: Exception) -> JSONResponse:
        log_unhandled_exception(request, exc)
        return JSONResponse(status_code=500, content={"error": str(exc) or _FALLBACK})

    app.add_exception_handler(RequestValidationError, _validation_error_handler)
    app.add_exception_handler(HTTPError, _route_http_error_handler)
    app.add_exception_handler(Exception, _route_generic_error_handler)

    app.include_router(health_router)
    app.include_router(generation_router)
    app.include_router(models_router)
    app.include_router(settings_router)
    app.include_router(image_gen_router)
    app.include_router(prompt_enhancer_router)
    app.include_router(suggest_gap_prompt_router)
    app.include_router(retake_router)
    app.include_router(ic_lora_router)
    app.include_router(runtime_policy_router)
    app.include_router(library_router)
    app.include_router(comfyui_router)

    allowed_media_roots = [root.resolve() for root in (media_roots or [])]

    if media_upload_root is not None:
        upload_root = media_upload_root.resolve()
        upload_root.mkdir(parents=True, exist_ok=True)

        @app.post("/api/media/upload", response_model=None)
        async def _upload_media_file(  # pyright: ignore[reportUnusedFunction]
            file: UploadFile = File(...),
            folder: str = Form(...),
        ) -> dict[str, str]:
            import re
            import uuid

            if not re.fullmatch(r"[A-Za-z0-9._-]+", folder) or folder in {".", ".."}:
                raise HTTPError(400, "Invalid media folder")
            if not file.content_type or file.content_type.split("/", 1)[0] not in {"image", "video", "audio"}:
                raise HTTPError(415, "Only image, video, and audio uploads are supported")

            original_name = Path(file.filename or "media").name
            suffix = Path(original_name).suffix
            stem = Path(original_name).stem or "media"
            destination_dir = upload_root / folder
            destination_dir.mkdir(parents=True, exist_ok=True)
            destination = destination_dir / original_name
            if destination.exists():
                destination = destination_dir / f"{stem}-{uuid.uuid4().hex[:8]}{suffix}"

            try:
                with destination.open("wb") as output:
                    while chunk := await file.read(1024 * 1024):
                        output.write(chunk)
            finally:
                await file.close()

            resolved = destination.resolve()
            return {"path": str(resolved), "url": f"/media?path={quote(str(resolved), safe='')}"}

    def _is_within_root(candidate: Path, root: Path) -> bool:
        try:
            candidate.relative_to(root)
            return True
        except ValueError:
            return False

    if allowed_media_roots:
        @app.get("/media", response_model=None)
        async def _serve_media_file(path: str = "") -> FileResponse | JSONResponse:  # pyright: ignore[reportUnusedFunction]
            if not path:
                return JSONResponse(status_code=400, content={"error": "Missing path"})

            candidate = Path(path).expanduser()
            if not candidate.is_absolute():
                return JSONResponse(status_code=400, content={"error": "Absolute path required"})

            try:
                resolved = candidate.resolve(strict=True)
            except FileNotFoundError:
                return JSONResponse(status_code=404, content={"error": "Not Found"})

            if not resolved.is_file():
                return JSONResponse(status_code=404, content={"error": "Not Found"})

            if not any(_is_within_root(resolved, root) for root in allowed_media_roots):
                return JSONResponse(status_code=403, content={"error": "Forbidden"})

            return FileResponse(resolved)

    if serve_frontend and static_dir is not None:
        index_file = static_dir / "index.html"

        @app.get("/")
        async def _serve_frontend_root() -> FileResponse:  # pyright: ignore[reportUnusedFunction]
            return FileResponse(index_file)

        @app.get("/{full_path:path}", response_model=None)
        async def _serve_frontend_asset(full_path: str) -> FileResponse | JSONResponse:  # pyright: ignore[reportUnusedFunction]
            if full_path.startswith(("api/", "comfyui-server", "health", "readyz", "docs", "openapi.json", "media")):
                return JSONResponse(status_code=404, content={"error": "Not Found"})

            candidate = static_dir / full_path
            if candidate.exists() and candidate.is_file():
                return FileResponse(candidate)

            return FileResponse(index_file)

    return app
