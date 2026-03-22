from __future__ import annotations

from pathlib import Path

from server_utils.app_paths import resolve_default_app_data_dir


def test_resolve_default_app_data_dir_uses_localappdata_on_windows(monkeypatch, tmp_path: Path):
    monkeypatch.setattr("platform.system", lambda: "Windows")
    monkeypatch.setattr(Path, "home", lambda: tmp_path / "home")
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "LocalAppData"))

    assert resolve_default_app_data_dir() == tmp_path / "LocalAppData" / "LTXDesktop"


def test_resolve_default_app_data_dir_falls_back_to_windows_home_layout(monkeypatch, tmp_path: Path):
    monkeypatch.setattr("platform.system", lambda: "Windows")
    monkeypatch.setattr(Path, "home", lambda: tmp_path / "home")
    monkeypatch.delenv("LOCALAPPDATA", raising=False)

    assert resolve_default_app_data_dir() == tmp_path / "home" / "AppData" / "Local" / "LTXDesktop"


def test_resolve_default_app_data_dir_uses_macos_layout(monkeypatch, tmp_path: Path):
    monkeypatch.setattr("platform.system", lambda: "Darwin")
    monkeypatch.setattr(Path, "home", lambda: tmp_path / "home")

    assert resolve_default_app_data_dir() == tmp_path / "home" / "Library" / "Application Support" / "LTXDesktop"


def test_resolve_default_app_data_dir_uses_xdg_data_home_on_linux(monkeypatch, tmp_path: Path):
    monkeypatch.setattr("platform.system", lambda: "Linux")
    monkeypatch.setattr(Path, "home", lambda: tmp_path / "home")
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "xdg-data"))

    assert resolve_default_app_data_dir() == tmp_path / "xdg-data" / "LTXDesktop"


def test_resolve_default_app_data_dir_falls_back_to_linux_home_layout(monkeypatch, tmp_path: Path):
    monkeypatch.setattr("platform.system", lambda: "Linux")
    monkeypatch.setattr(Path, "home", lambda: tmp_path / "home")
    monkeypatch.delenv("XDG_DATA_HOME", raising=False)

    assert resolve_default_app_data_dir() == tmp_path / "home" / ".local" / "share" / "LTXDesktop"