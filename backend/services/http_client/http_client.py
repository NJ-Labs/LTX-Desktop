"""HTTP client service protocol definitions."""

from __future__ import annotations

from collections.abc import Iterator, Mapping
from typing import Protocol

from services.services_utils import JSONValue, RequestData


class HttpTimeoutError(Exception):
    """Raised by HTTP service implementations when a request times out."""


class HttpResponseLike(Protocol):
    @property
    def status_code(self) -> int:
        ...

    @property
    def text(self) -> str:
        ...

    @property
    def headers(self) -> Mapping[str, str]:
        ...

    @property
    def content(self) -> bytes:
        ...

    def json(self) -> object:
        ...

    def iter_lines(self) -> Iterator[bytes]:
        ...

    def close(self) -> None:
        ...


class HTTPClient(Protocol):
    def stream_post(
        self,
        url: str,
        headers: dict[str, str] | None = None,
        json_payload: Mapping[str, JSONValue] | None = None,
        timeout: int = 30,
    ) -> HttpResponseLike:
        ...

    def post(
        self,
        url: str,
        headers: dict[str, str] | None = None,
        json_payload: Mapping[str, JSONValue] | None = None,
        data: RequestData = None,
        timeout: int = 30,
    ) -> HttpResponseLike:
        ...

    def get(
        self,
        url: str,
        headers: dict[str, str] | None = None,
        timeout: int = 30,
    ) -> HttpResponseLike:
        ...

    def put(
        self,
        url: str,
        data: RequestData = None,
        headers: dict[str, str] | None = None,
        timeout: int = 300,
    ) -> HttpResponseLike:
        ...
