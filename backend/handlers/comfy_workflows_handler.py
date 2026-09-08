"""Publish executable workflows and track their isolated ComfyUI jobs."""

from __future__ import annotations

import asyncio
import math
import mimetypes
import time
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path
from typing import Protocol
from urllib.parse import urlencode
from uuid import uuid4

from pydantic import JsonValue

from _routes._errors import HTTPError
from api_types import ComfyRunPayload, ComfyRunRequest, ComfyWorkflowPayload, ComfyWorkflowRequest
from services.comfy_workflow_store import ComfyWorkflowStore
from services.comfyui_service import ComfyUIStatus


class ComfyRuntime(Protocol):
    def status(self) -> ComfyUIStatus: ...
    async def start(self) -> ComfyUIStatus: ...
    def stop(self) -> None: ...
    async def request_json(self, method: str, path: str, payload: dict[str, JsonValue] | None = None) -> dict[str, JsonValue]: ...


class ComfyWorkflowsHandler:
    def __init__(self, store: ComfyWorkflowStore, *, reserve: Callable[[str], bool],
                 release: Callable[[str], None], unload_native: Callable[[], None]) -> None:
        self.store = store
        self.runtime: ComfyRuntime | None = None
        self._run_lock = asyncio.Lock()
        self._reserve = reserve
        self._release = release
        self._unload_native = unload_native
        self._active_run: str | None = None
        self._monitor: asyncio.Task[None] | None = None
        self._missing_since: dict[str, float] = {}

    def require_runtime(self) -> ComfyRuntime:
        if self.runtime is None:
            raise HTTPError(503, "ComfyUI is not configured for this server.")
        return self.runtime

    def list_workflows(self) -> list[ComfyWorkflowPayload]:
        return self.store.workflows()

    def save(self, payload: ComfyWorkflowRequest, workflow_id: str | None = None) -> ComfyWorkflowPayload:
        if workflow_id is not None:
            self.store.workflow(workflow_id)
        # Links are [node ID, output index]; editor JSON is never executable.
        for node_id, node in payload.prompt.items():
            for value in node.inputs.values():
                if isinstance(value, list) and len(value) == 2 and isinstance(value[0], str) and type(value[1]) is int:
                    if value[0] not in payload.prompt or value[1] < 0 or value[0] == node_id:
                        raise HTTPError(422, f"Node {node_id} has an invalid connection to {value[0]}.")
        keys: set[str] = set()
        bindings: set[tuple[str, str]] = set()
        for field in payload.inputs:
            node = payload.prompt.get(field.node_id)
            if node is None or field.input_name not in node.inputs:
                raise HTTPError(422, f"Input {field.label} refers to a missing node input.")
            value = node.inputs[field.input_name]
            if type(value) not in (str, int, float, bool):
                raise HTTPError(422, f"Input {field.label} must expose a text, number or checkbox value.")
            binding = (field.node_id, field.input_name)
            if field.key in keys or binding in bindings:
                raise HTTPError(422, "Workflow inputs must have unique keys and bindings.")
            keys.add(field.key)
            bindings.add(binding)
        saved = ComfyWorkflowPayload(**payload.model_dump(), id=workflow_id or uuid4().hex,
                                     updated_at=datetime.now(timezone.utc).isoformat())
        self.store.save_workflow(saved)
        return saved

    async def run(self, workflow_id: str, request: ComfyRunRequest) -> ComfyRunPayload:
        workflow = self.store.workflow(workflow_id)
        fields = {field.key: field for field in workflow.inputs}
        unknown = request.values.keys() - fields.keys()
        if unknown:
            raise HTTPError(422, f"Unknown workflow inputs: {', '.join(sorted(unknown))}")
        prompt = {key: node.model_copy(deep=True) for key, node in workflow.prompt.items()}
        for key, value in request.values.items():
            field = fields[key]
            original = prompt[field.node_id].inputs[field.input_name]
            if (type(value) is not type(original) and not (type(original) is float and type(value) is int)) or (isinstance(value, float) and not math.isfinite(value)):
                raise HTTPError(422, f"Input {field.label} has the wrong value type.")
            prompt[field.node_id].inputs[field.input_name] = value
        runtime = self.require_runtime()
        async with self._run_lock:
            status = await runtime.start()
            if status.state != "running":
                raise HTTPError(503, status.error or "ComfyUI is not ready.")
            catalog = await runtime.request_json("GET", "/object_info")
            missing = sorted({node.class_type for node in prompt.values()} - catalog.keys())
            if missing:
                raise HTTPError(422, f"Install the workflow's missing ComfyUI nodes: {', '.join(missing)}")
            run_id = uuid4().hex
            run, _ = await self._submit(runtime, workflow_id, run_id, {
                "prompt": {key: node.model_dump(mode="json") for key, node in prompt.items()},
                "client_id": f"ltx-studio-{run_id}",
                "extra_data": {"extra_pnginfo": {"workflow": workflow.workflow}},
            })
            return run

    async def queue_editor(self, payload: dict[str, JsonValue]) -> dict[str, JsonValue]:
        """Editor jobs use the same device reservation as Studio blocks."""
        async with self._run_lock:
            _, reply = await self._submit(self.require_runtime(), "editor", uuid4().hex, payload)
            return reply

    async def _submit(self, runtime: ComfyRuntime, workflow_id: str, run_id: str,
                      payload: dict[str, JsonValue]) -> tuple[ComfyRunPayload, dict[str, JsonValue]]:
        if not self._reserve(run_id):
            raise HTTPError(409, "A generation is already using this server. Wait for it to finish or cancel it before running another workflow.")
        try:
            await asyncio.to_thread(self._unload_native)
            queued = await runtime.request_json("POST", "/prompt", payload)
            prompt_id = queued.get("prompt_id")
            if not isinstance(prompt_id, str) or queued.get("node_errors"):
                raise HTTPError(422, f"ComfyUI rejected this workflow: {queued}")
            run = ComfyRunPayload(id=run_id, workflow_id=workflow_id, prompt_id=prompt_id, state="queued")
            self.store.save_run(run)
        except BaseException:
            # A lost submission response can still mean work was accepted. Stop
            # this managed process before handing the device back to native code.
            await asyncio.to_thread(runtime.stop)
            self._release(run_id)
            raise
        self._active_run = run_id
        self._monitor = asyncio.create_task(self._watch(run_id))
        return run, queued

    async def _watch(self, run_id: str) -> None:
        while self._active_run == run_id:
            await asyncio.sleep(1)
            try:
                await self.get_run(run_id)
            except HTTPError:
                # A transport failure is not evidence that the GPU is free.
                if self.require_runtime().status().state in {"stopped", "error"}:
                    async with self._run_lock:
                        run = self.store.run(run_id)
                        if run.state not in {"complete", "error", "cancelled"}:
                            run.state = "error"
                            run.error = "ComfyUI stopped before the run completed."
                            self.store.save_run(run)
                        self._release(run_id)
                        self._active_run = None

    async def _release_finished(self, run: ComfyRunPayload, runtime: ComfyRuntime) -> None:
        if self._active_run != run.id or run.state not in {"complete", "error", "cancelled"}:
            return
        queue = await runtime.request_json("GET", "/queue")
        if self._queued(queue.get("queue_running"), run.prompt_id) or self._queued(queue.get("queue_pending"), run.prompt_id):
            return
        # The stock /free endpoint only schedules cleanup. Our bridge responds
        # after cleanup, so native inference cannot race cached allocations.
        await runtime.request_json("POST", "/ltx/release-memory", {})
        self._release(run.id)
        self._active_run = None

    async def stop(self) -> None:
        # Cancel the monitor first; it never owns the process independently.
        if self._monitor is not None:
            self._monitor.cancel()
            await asyncio.gather(self._monitor, return_exceptions=True)
            self._monitor = None
        async with self._run_lock:
            await asyncio.to_thread(self.require_runtime().stop)
            if self._active_run is not None:
                run = self.store.run(self._active_run)
                if run.state not in {"complete", "error", "cancelled"}:
                    run.state = "cancelled"
                    self.store.save_run(run)
                self._release(self._active_run)
                self._active_run = None

    async def get_run(self, run_id: str) -> ComfyRunPayload:
        async with self._run_lock:
            run = self.store.run(run_id)
            runtime = self.require_runtime()
            if run.state in {"complete", "error", "cancelled"}:
                await self._release_finished(run, runtime)
                return run
            history = await runtime.request_json("GET", f"/history/{run.prompt_id}")
            entry = history.get(run.prompt_id)
            if isinstance(entry, dict):
                status = entry.get("status")
                if isinstance(status, dict) and status.get("status_str") == "error":
                    run.state = "error"
                    run.error = self._execution_error(status)
                elif isinstance(status, dict) and status.get("completed") is True:
                    run.outputs = self._outputs(entry, runtime.status())
                    run.state = "complete" if run.outputs else "error"
                    if not run.outputs:
                        run.error = "Workflow finished without saved media. Add a Save Image, Save Video or Save Audio output node."
            else:
                queue = await runtime.request_json("GET", "/queue")
                if self._queued(queue.get("queue_running"), run.prompt_id):
                    run.state = "running"
                elif self._queued(queue.get("queue_pending"), run.prompt_id):
                    run.state = "queued"
                else:
                    # Completion may land between the history and queue reads.
                    again = await runtime.request_json("GET", f"/history/{run.prompt_id}")
                    if run.prompt_id in again:
                        self._missing_since.pop(run_id, None)
                    elif time.monotonic() - self._missing_since.setdefault(run_id, time.monotonic()) >= 5:
                        run.state = "error"
                        run.error = "ComfyUI no longer has this run. It may have restarted or the queue was cleared. You can run the saved workflow again."
            self.store.save_run(run)
            await self._release_finished(run, runtime)
            return run

    async def cancel(self, run_id: str) -> ComfyRunPayload:
        async with self._run_lock:
            run = self.store.run(run_id)
            if run.state in {"complete", "error", "cancelled"}:
                return run
            runtime = self.require_runtime()
            result = await runtime.request_json("POST", f"/api/jobs/{run.prompt_id}/cancel", {})
            if result.get("cancelled") is not True:
                raise HTTPError(409, "The run has left the queue. Refresh its status before cancelling.")
            run.state = "cancelled"
            self.store.save_run(run)
            return run

    @staticmethod
    def _queued(value: JsonValue, prompt_id: str) -> bool:
        return isinstance(value, list) and any(isinstance(item, list) and len(item) > 1 and item[1] == prompt_id for item in value)

    @staticmethod
    def _execution_error(status: dict[str, JsonValue]) -> str:
        messages = status.get("messages")
        if isinstance(messages, list):
            for item in reversed(messages):
                if isinstance(item, list) and len(item) > 1 and isinstance(item[1], dict):
                    detail = item[1].get("exception_message")
                    if isinstance(detail, str):
                        return detail
        return "ComfyUI could not execute this workflow. Open its queue for node error details."

    @staticmethod
    def _outputs(entry: dict[str, JsonValue], status: ComfyUIStatus) -> list[dict[str, JsonValue]]:
        outputs: list[dict[str, JsonValue]] = []
        nodes = entry.get("outputs")
        if not isinstance(nodes, dict):
            return outputs
        seen: set[str] = set()
        for node in nodes.values():
            if not isinstance(node, dict):
                continue
            for items in node.values():
                if not isinstance(items, list):
                    continue
                for item in items:
                    if not isinstance(item, dict) or item.get("type") != "output":
                        continue
                    filename, subfolder = item.get("filename"), item.get("subfolder", "")
                    if not isinstance(filename, str) or not isinstance(subfolder, str):
                        continue
                    root = Path(status.output_path).resolve()
                    path = (root / subfolder / filename).resolve()
                    if not path.is_relative_to(root) or str(path) in seen:
                        continue
                    media_type = (mimetypes.guess_type(filename)[0] or "").split("/")[0]
                    if media_type not in {"image", "video", "audio"}:
                        continue
                    seen.add(str(path))
                    outputs.append({"filename": filename, "subfolder": subfolder, "type": "output",
                                    "media_type": media_type, "path": str(path),
                                    "url": "/media?" + urlencode({"path": str(path)})})
        return outputs
