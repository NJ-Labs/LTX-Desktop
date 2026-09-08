"""Atomic, persistent ComfyUI workflow and job records."""

from __future__ import annotations

import os
import re
import tempfile
from pathlib import Path
from threading import RLock

from pydantic import BaseModel

from _routes._errors import HTTPError
from api_types import ComfyRunPayload, ComfyWorkflowPayload


class ComfyWorkflowStore:
    def __init__(self, root: Path) -> None:
        self.root = root
        self._lock = RLock()

    def _path(self, kind: str, record_id: str) -> Path:
        if not re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", record_id):
            raise HTTPError(404, "Workflow or run not found.")
        return self.root / kind / f"{record_id}.json"

    def _write(self, kind: str, record_id: str, payload: BaseModel) -> None:
        path = self._path(kind, record_id)
        with self._lock:
            path.parent.mkdir(parents=True, exist_ok=True)
            fd, temp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as output:
                    output.write(payload.model_dump_json(indent=2))
                    output.flush()
                    os.fsync(output.fileno())
                os.replace(temp, path)
            finally:
                Path(temp).unlink(missing_ok=True)

    def workflows(self) -> list[ComfyWorkflowPayload]:
        with self._lock:
            return sorted(
                [ComfyWorkflowPayload.model_validate_json(path.read_text(encoding="utf-8"))
                 for path in (self.root / "workflows").glob("*.json")],
                key=lambda item: item.updated_at, reverse=True,
            )

    def workflow(self, workflow_id: str) -> ComfyWorkflowPayload:
        path = self._path("workflows", workflow_id)
        with self._lock:
            if not path.exists():
                raise HTTPError(404, "Workflow not found.")
            return ComfyWorkflowPayload.model_validate_json(path.read_text(encoding="utf-8"))

    def save_workflow(self, payload: ComfyWorkflowPayload) -> None:
        self._write("workflows", payload.id, payload)

    def run(self, run_id: str) -> ComfyRunPayload:
        path = self._path("runs", run_id)
        with self._lock:
            if not path.exists():
                raise HTTPError(404, "Workflow run not found.")
            return ComfyRunPayload.model_validate_json(path.read_text(encoding="utf-8"))

    def save_run(self, payload: ComfyRunPayload) -> None:
        self._write("runs", payload.id, payload)
