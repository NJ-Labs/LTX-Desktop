"""ComfyUI lifecycle, published workflows and same-origin editor transport."""
from __future__ import annotations

import asyncio
import base64
import hmac
import json
from typing import cast
from urllib.error import HTTPError as UrlHTTPError
from urllib.request import Request as UrlRequest, urlopen

from fastapi import APIRouter, Depends, Request, WebSocket, WebSocketDisconnect
from pydantic import JsonValue, TypeAdapter, ValidationError
from starlette.responses import Response
from websockets.asyncio.client import connect

from _routes._errors import HTTPError
from api_types import ComfyRunPayload, ComfyRunRequest, ComfyWorkflowPayload, ComfyWorkflowRequest
from app_handler import AppHandler
from state import get_state_service

router = APIRouter(tags=["comfyui"])


def _public_status(request: Request, response: Response, handler: AppHandler) -> dict[str, object]:
    session = cast(str, request.app.state.comfy_session)
    if session:
        response.set_cookie("ltx_comfy_session", session, httponly=True, samesite="lax",
                            secure=request.url.scheme == "https", path="/comfyui-server/", max_age=28800)
    return handler.comfy_workflows.require_runtime().status().to_payload(
        public_url=str(request.base_url).rstrip("/") + "/comfyui-server/",
    )


@router.get("/api/comfyui/status")
def route_status(request: Request, response: Response, handler: AppHandler = Depends(get_state_service)) -> dict[str, object]:
    return _public_status(request, response, handler)


@router.post("/api/comfyui/start")
async def route_start(request: Request, response: Response, handler: AppHandler = Depends(get_state_service)) -> dict[str, object]:
    await handler.comfy_workflows.require_runtime().start()
    return _public_status(request, response, handler)


@router.get("/api/comfyui/workflows")
def route_workflows(handler: AppHandler = Depends(get_state_service)) -> list[ComfyWorkflowPayload]:
    return handler.comfy_workflows.list_workflows()


@router.post("/api/comfyui/stop")
async def route_stop(handler: AppHandler = Depends(get_state_service)) -> dict[str, object]:
    runtime = handler.comfy_workflows.require_runtime()
    await handler.comfy_workflows.stop()
    return runtime.status().to_payload()


@router.post("/api/comfyui/workflows")
def route_save(payload: ComfyWorkflowRequest, handler: AppHandler = Depends(get_state_service)) -> ComfyWorkflowPayload:
    return handler.comfy_workflows.save(payload)


@router.put("/api/comfyui/workflows/{workflow_id}")
def route_update(workflow_id: str, payload: ComfyWorkflowRequest, handler: AppHandler = Depends(get_state_service)) -> ComfyWorkflowPayload:
    return handler.comfy_workflows.save(payload, workflow_id)


@router.post("/api/comfyui/workflows/{workflow_id}/run")
async def route_run(workflow_id: str, payload: ComfyRunRequest, handler: AppHandler = Depends(get_state_service)) -> ComfyRunPayload:
    return await handler.comfy_workflows.run(workflow_id, payload)


@router.get("/api/comfyui/runs/{run_id}")
async def route_run_status(run_id: str, handler: AppHandler = Depends(get_state_service)) -> ComfyRunPayload:
    return await handler.comfy_workflows.get_run(run_id)


@router.post("/api/comfyui/runs/{run_id}/cancel")
async def route_cancel(run_id: str, handler: AppHandler = Depends(get_state_service)) -> ComfyRunPayload:
    return await handler.comfy_workflows.cancel(run_id)


@router.api_route("/comfyui-server/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def route_proxy(path: str, request: Request, handler: AppHandler = Depends(get_state_service)) -> Response:
    runtime = handler.comfy_workflows.require_runtime()
    status = runtime.status()
    if status.state != "running" or not status.url:
        raise HTTPError(503, status.error or "Start ComfyUI before opening the editor.")
    target = f"{status.url}/{path}"
    if request.url.query:
        target += f"?{request.url.query}"
    body = await request.body()
    if request.method == "POST" and path.rstrip("/") in {"prompt", "api/prompt"}:
        try:
            payload = TypeAdapter(dict[str, JsonValue]).validate_json(body)
        except ValidationError as exc:
            raise HTTPError(422, "The workflow request must be a JSON object.") from exc
        result = await handler.comfy_workflows.queue_editor(payload)
        return Response(content=json.dumps(result), media_type="application/json")
    headers = {key: value for key, value in request.headers.items()
               if not key.lower().startswith("sec-fetch-") and
               key.lower() not in {"host", "content-length", "connection", "accept-encoding", "authorization", "cookie", "origin"}}
    return await asyncio.to_thread(_proxy_http_request, request.method, target, headers, body, path)


def _ws_authenticated(websocket: WebSocket) -> bool:
    token = cast(str, websocket.app.state.auth_token)
    if not token:
        return True
    session = cast(str, websocket.app.state.comfy_session)
    if hmac.compare_digest(websocket.cookies.get("ltx_comfy_session", ""), session):
        return True
    header = websocket.headers.get("authorization", "")
    if header.startswith("Bearer "):
        return hmac.compare_digest(header[7:], token)
    if header.startswith("Basic "):
        try:
            password = base64.b64decode(header[6:]).decode().partition(":")[2]
            return hmac.compare_digest(password, token)
        except (ValueError, UnicodeError):
            return False
    return False


@router.websocket("/comfyui-server/ws")
async def route_ws(websocket: WebSocket) -> None:
    if not _ws_authenticated(websocket):
        await websocket.close(code=1008)
        return
    handler = cast(AppHandler, websocket.app.state.handler)
    status = handler.comfy_workflows.require_runtime().status()
    if status.state != "running" or not status.url:
        await websocket.close(code=1011)
        return
    target = status.url.replace("http://", "ws://").replace("https://", "wss://") + "/ws"
    if websocket.url.query:
        target += "?" + websocket.url.query
    await websocket.accept()
    tasks: set[asyncio.Task[None]] = set()
    try:
        async with connect(target, max_size=None) as upstream:
            async def send_upstream() -> None:
                while True:
                    message = await websocket.receive()
                    if message["type"] == "websocket.disconnect":
                        return
                    if message.get("text") is not None:
                        await upstream.send(message["text"])
                    elif message.get("bytes") is not None:
                        await upstream.send(message["bytes"])

            async def send_client() -> None:
                async for message in upstream:
                    if isinstance(message, bytes):
                        await websocket.send_bytes(message)
                    else:
                        await websocket.send_text(message)

            tasks = {asyncio.create_task(send_upstream()), asyncio.create_task(send_client())}
            done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                task.result()
    except WebSocketDisconnect:
        pass
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


def _proxy_http_request(method: str, target: str, headers: dict[str, str], body: bytes, path: str = "") -> Response:
    request = UrlRequest(target, data=body if body else None, headers=headers, method=method)
    try:
        upstream = urlopen(request, timeout=120)
    except UrlHTTPError as exc:
        upstream = exc
    except Exception as exc:
        raise HTTPError(502, f"ComfyUI proxy request failed: {exc}") from exc
    with upstream:
        data = upstream.read()
        content_type = upstream.headers.get_content_type()
        if content_type == "text/html":
            text = data.decode("utf-8")
            for attr in ("src", "href"):
                text = text.replace(f'{attr}="/', f'{attr}="/comfyui-server/')
            data = text.encode("utf-8")
        response_headers = {key: value for key, value in upstream.headers.items()
                            if key.lower() not in {"content-length", "content-encoding", "transfer-encoding", "connection", "set-cookie"}}
        code = upstream.getcode()
        if not isinstance(code, int):
            raise HTTPError(502, "ComfyUI returned an invalid HTTP status.")
        return Response(content=data, status_code=code, headers=response_headers, media_type=content_type)
