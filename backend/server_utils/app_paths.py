from __future__ import annotations

import os
import platform
from pathlib import Path


APP_FOLDER_NAME = "LTXDesktop"


def resolve_default_app_data_dir() -> Path:
    system = platform.system()
    home = Path.home()

    if system == "Windows":
        local_app_data = os.environ.get("LOCALAPPDATA")
        base_dir = Path(local_app_data) if local_app_data else home / "AppData" / "Local"
        return base_dir / APP_FOLDER_NAME

    if system == "Darwin":
        return home / "Library" / "Application Support" / APP_FOLDER_NAME

    xdg_data_home = os.environ.get("XDG_DATA_HOME")
    base_dir = Path(xdg_data_home) if xdg_data_home else home / ".local" / "share"
    return base_dir / APP_FOLDER_NAME