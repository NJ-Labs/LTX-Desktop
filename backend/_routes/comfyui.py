"""Routes for managed ComfyUI in web/self-hosted deployments."""

from __future__ import annotations

from typing import TYPE_CHECKING
from urllib.parse import urlencode
from urllib.error import HTTPError as UrlHTTPError
from urllib.request import Request as UrlRequest
from urllib.request import urlopen

from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect
from starlette.responses import Response

from _routes._errors import HTTPError

if TYPE_CHECKING:
    from services.comfyui_service import ComfyUIService

router = APIRouter(tags=["comfyui"])

_service: "ComfyUIService | None" = None


def init_comfyui_service(service: "ComfyUIService | None") -> None:
    global _service
    _service = service


def _require_service() -> "ComfyUIService":
    if _service is None:
        raise HTTPError(503, "ComfyUI is not configured for this server.")
    return _service


def _public_status_payload(request: Request) -> dict[str, object]:
    status = _require_service().status()
    public_url = str(request.base_url).rstrip("/") + "/comfyui-server/"
    return status.to_payload(public_url=public_url)


@router.get("/api/comfyui/status")
def route_comfyui_status(request: Request) -> dict[str, object]:
    return _public_status_payload(request)


@router.post("/api/comfyui/start")
async def route_start_comfyui(request: Request) -> dict[str, object]:
    service = _require_service()
    await service.start()
    return _public_status_payload(request)


@router.api_route("/comfyui-server/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def route_comfyui_proxy(path: str, request: Request) -> Response:
    status = _require_service().status()
    if status.state != "running" or not status.url:
        await _require_service().start()
        status = _require_service().status()
    if not status.url:
        raise HTTPError(503, status.error or "ComfyUI is not running.")

    query = request.url.query
    target = f"{status.url}/{path}"
    if query:
        target = f"{target}?{query}"

    body = await request.body()
    headers = {
        key: value
        for key, value in request.headers.items()
        if key.lower() not in {"host", "content-length", "connection", "accept-encoding"}
    }

    import asyncio

    return await asyncio.to_thread(_proxy_http_request, request.method, target, headers, body)


@router.websocket("/comfyui-server/ws")
async def route_comfyui_ws(websocket: WebSocket) -> None:
    status = _require_service().status()
    if status.state != "running" or not status.url:
        await _require_service().start()
        status = _require_service().status()
    if not status.url:
        await websocket.close(code=1011)
        return

    await websocket.accept()
    ws_url = status.url.replace("http://", "ws://").replace("https://", "wss://")
    query = urlencode(dict(websocket.query_params))
    target = f"{ws_url}/ws"
    if query:
        target = f"{target}?{query}"

    try:
        import websockets  # type: ignore[reportMissingImports]

        async with websockets.connect(target) as upstream:  # type: ignore[reportUnknownMemberType]
            import asyncio

            async def client_to_upstream() -> None:
                while True:
                    message = await websocket.receive()
                    if "text" in message:
                        await upstream.send(message["text"])
                    elif "bytes" in message:
                        await upstream.send(message["bytes"])

            async def upstream_to_client() -> None:
                async for message in upstream:
                    if isinstance(message, bytes):
                        await websocket.send_bytes(message)
                    else:
                        await websocket.send_text(message)

            done, pending = await asyncio.wait(
                {asyncio.create_task(client_to_upstream()), asyncio.create_task(upstream_to_client())},
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
            for task in done:
                task.result()
    except WebSocketDisconnect:
        return
    except Exception:
        await websocket.close(code=1011)


def _proxy_http_request(method: str, target: str, headers: dict[str, str], body: bytes) -> Response:
    request = UrlRequest(target, data=body if body else None, headers=headers, method=method)
    try:
        with urlopen(request, timeout=120) as upstream:
            response_headers = {
                key: value
                for key, value in upstream.headers.items()
                if key.lower() not in {"content-encoding", "transfer-encoding", "connection"}
            }
            return Response(
                content=upstream.read(),
                status_code=upstream.status,
                headers=response_headers,
                media_type=upstream.headers.get_content_type(),
            )
    except UrlHTTPError as exc:
        response_headers = {
            key: value
            for key, value in exc.headers.items()
            if key.lower() not in {"content-encoding", "transfer-encoding", "connection"}
        }
        return Response(
            content=exc.read(),
            status_code=exc.code,
            headers=response_headers,
            media_type=exc.headers.get_content_type(),
        )
    except Exception as exc:
        raise HTTPError(502, f"ComfyUI proxy request failed: {exc}") from exc
