"""Same-origin ComfyUI proxy contracts against real loopback servers."""

from __future__ import annotations

from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

import pytest
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from websockets.sync.server import ServerConnection, serve

from _routes._errors import HTTPError
from app_factory import create_app
from services.comfyui_service import ComfyUIStatus


class ProxyRuntime:
    def __init__(self, url: str, output_path: Path) -> None:
        self.url = url
        self.output_path = output_path

    def status(self) -> ComfyUIStatus:
        root = str(self.output_path)
        return ComfyUIStatus("running", self.url, None, None, root, root, root, root, root)

    async def start(self) -> ComfyUIStatus:
        return self.status()

    def stop(self) -> None:
        pass

    async def request_json(self, method, path, payload=None):
        raise AssertionError(f"Unexpected runtime request: {method} {path} {payload}")


class WorkflowFacade:
    def __init__(self) -> None:
        self.runtime = None
        self.editor_error: HTTPError | None = None

    def require_runtime(self):
        assert self.runtime is not None
        return self.runtime

    async def stop(self) -> None:
        if self.runtime is not None:
            self.runtime.stop()

    async def queue_editor(self, payload):
        if self.editor_error is not None:
            raise self.editor_error
        raise AssertionError(f"Unexpected editor queue request: {payload}")


class RouteHandler:
    def __init__(self) -> None:
        self.comfy_workflows = WorkflowFacade()


@pytest.fixture(autouse=True)
def test_state():
    return RouteHandler()


class UpstreamHandler(BaseHTTPRequestHandler):
    server_version = "ComfyProxyTest/1"

    def do_GET(self) -> None:
        self.server.requests.append((self.path, dict(self.headers.items())))
        if self.path.startswith("/binary"):
            body = b"\x00\xffcomfy"
            self.send_response(418)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("X-Upstream", "kept")
            self.send_header("Set-Cookie", "upstream-secret=1")
        elif self.path == "/extensions":
            body = b'["/extensions/core.js", "/extensions/custom/node.js", "relative.js"]'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
        else:
            body = b'<script src="/assets/app.js"></script><a href="/docs">Docs</a>'
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        del format, args


@contextmanager
def http_upstream():
    server = ThreadingHTTPServer(("127.0.0.1", 0), UpstreamHandler)
    server.requests = []
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        host, port = server.server_address
        yield f"http://{host}:{port}", server.requests
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_http_proxy_strips_credentials_and_preserves_binary_error_response(test_state, tmp_path: Path) -> None:
    with http_upstream() as (url, requests):
        runtime = ProxyRuntime(url, tmp_path)
        with TestClient(create_app(handler=test_state, comfyui_service=runtime, auth_token="secret")) as client:
            response = client.get(
                "/comfyui-server/binary?preview=1",
                headers={
                    "Authorization": "Bearer secret", "Cookie": "private=1", "Origin": "https://example.test",
                    "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate",
                },
            )

    assert response.status_code == 418
    assert response.content == b"\x00\xffcomfy"
    assert response.headers["content-type"] == "application/octet-stream"
    assert response.headers["x-upstream"] == "kept"
    assert "set-cookie" not in response.headers
    path, headers = requests[0]
    assert path == "/binary?preview=1"
    assert "Authorization" not in headers
    assert "Cookie" not in headers
    assert "Origin" not in headers
    assert not any(name.lower().startswith("sec-fetch-") for name in headers)


def test_http_proxy_rewrites_editor_but_preserves_extension_paths_for_comfy_api_url(test_state, tmp_path: Path) -> None:
    with http_upstream() as (url, _requests):
        runtime = ProxyRuntime(url, tmp_path)
        with TestClient(create_app(handler=test_state, comfyui_service=runtime)) as client:
            html = client.get("/comfyui-server/")
            extensions = client.get("/comfyui-server/extensions")

    assert html.status_code == 200
    assert 'src="/comfyui-server/assets/app.js"' in html.text
    assert 'href="/comfyui-server/docs"' in html.text
    assert extensions.json() == [
        "/extensions/core.js",
        "/extensions/custom/node.js",
        "relative.js",
    ]


@pytest.mark.parametrize("path", ["prompt", "api/prompt"])
def test_editor_prompt_does_not_bypass_denied_device_lease(test_state, tmp_path: Path, path: str) -> None:
    test_state.comfy_workflows.editor_error = HTTPError(409, "GPU busy")
    with http_upstream() as (url, requests):
        runtime = ProxyRuntime(url, tmp_path)
        with TestClient(create_app(handler=test_state, comfyui_service=runtime)) as client:
            response = client.post(f"/comfyui-server/{path}", json={"prompt": {"1": {}}})

    assert response.status_code == 409
    assert response.json() == {"error": "GPU busy"}
    assert requests == []


def test_status_cookie_authenticates_websocket_proxy(test_state, tmp_path: Path) -> None:
    paths: list[str] = []

    def echo(connection: ServerConnection) -> None:
        paths.append(connection.request.path)
        for message in connection:
            connection.send(message)

    server = serve(echo, "127.0.0.1", 0)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        host, port = server.socket.getsockname()
        runtime = ProxyRuntime(f"http://{host}:{port}", tmp_path)
        with TestClient(create_app(handler=test_state, comfyui_service=runtime, auth_token="secret")) as client:
            with pytest.raises(WebSocketDisconnect) as rejected:
                with client.websocket_connect("/comfyui-server/ws"):
                    pass
            assert rejected.value.code == 1008

            status = client.get("/api/comfyui/status", headers={"Authorization": "Bearer secret"})
            assert status.status_code == 200
            assert "HttpOnly" in status.headers["set-cookie"]
            assert "Path=/comfyui-server/" in status.headers["set-cookie"]

            with client.websocket_connect("/comfyui-server/ws?clientId=studio") as websocket:
                websocket.send_text("hello")
                assert websocket.receive_text() == "hello"
                websocket.send_bytes(b"\x00\x01")
                assert websocket.receive_bytes() == b"\x00\x01"
    finally:
        server.shutdown()
        thread.join(timeout=2)

    assert paths == ["/ws?clientId=studio"]
