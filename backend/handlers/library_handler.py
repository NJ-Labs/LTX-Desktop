"""Persistent project library storage for self-hosted/web deployments.

Desktop builds keep projects in the renderer's localStorage. Web/self-hosted
deployments have no per-browser persistence guarantee, so the full project list
and Playground assets are stored server-side under the app data directory and
survive container restarts when that directory is mounted.
"""

from __future__ import annotations

import json
import logging
import os
from threading import RLock

from api_types import LibraryPayload
from handlers.base import StateHandlerBase, with_state_lock
from runtime_config.runtime_config import RuntimeConfig
from state.app_state_types import AppState

logger = logging.getLogger(__name__)


class LibraryHandler(StateHandlerBase):
    def __init__(self, state: AppState, lock: RLock, config: RuntimeConfig) -> None:
        super().__init__(state, lock, config)

    @with_state_lock
    def load_library(self) -> LibraryPayload:
        library_file = self.config.library_file
        if not library_file.exists():
            return LibraryPayload()
        try:
            with open(library_file, "r", encoding="utf-8") as f:
                payload = json.load(f)
            return LibraryPayload.model_validate(payload)
        except Exception as exc:
            logger.warning("Could not load project library: %s", exc, exc_info=True)
            return LibraryPayload()

    @with_state_lock
    def save_library(self, payload: LibraryPayload) -> None:
        library_file = self.config.library_file
        library_file.parent.mkdir(parents=True, exist_ok=True)
        data = payload.model_dump(by_alias=True)
        tmp_file = library_file.with_suffix(library_file.suffix + ".tmp")
        try:
            with open(tmp_file, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
            os.replace(tmp_file, library_file)
        except Exception as exc:
            logger.warning("Could not save project library: %s", exc, exc_info=True)
            tmp_file.unlink(missing_ok=True)
