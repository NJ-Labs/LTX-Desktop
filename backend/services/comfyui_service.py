"""Managed ComfyUI process for self-hosted/web deployments."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import socket
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Literal
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)

ComfyUIState = Literal["stopped", "starting", "running", "error"]


@dataclass(frozen=True)
class ComfyUIStatus:
    state: ComfyUIState
    url: str | None
    port: int | None
    error: str | None
    ltx_data_path: str
    ltx_models_path: str
    input_path: str
    output_path: str
    user_path: str

    def to_payload(self, public_url: str | None = None) -> dict[str, object]:
        return {
            "state": self.state,
            "url": public_url or self.url,
            "port": self.port,
            "error": self.error,
            "ltxDataPath": self.ltx_data_path,
            "ltxModelsPath": self.ltx_models_path,
            "inputPath": self.input_path,
            "outputPath": self.output_path,
            "userPath": self.user_path,
        }


@dataclass(frozen=True)
class ComfyUIPaths:
    root_path: Path
    ltx_video_custom_node_path: Path
    ltx_data_path: Path
    ltx_models_path: Path
    input_path: Path
    output_path: Path
    temp_path: Path
    user_path: Path
    extra_model_paths_config: Path


class ComfyUIService:
    def __init__(self, *, project_root: Path, app_data_dir: Path, data_dir: Path, models_dir: Path) -> None:
        self._project_root = project_root
        self._app_data_dir = app_data_dir
        self._data_dir = data_dir
        self._models_dir = models_dir
        self._process: subprocess.Popen[str] | None = None
        self._state: ComfyUIState = "stopped"
        self._url: str | None = None
        self._port: int | None = None
        self._error: str | None = None
        self._paths: ComfyUIPaths | None = None
        self._lock = asyncio.Lock()

    def status(self) -> ComfyUIStatus:
        paths = self._paths or self._default_paths()
        return ComfyUIStatus(
            state=self._state,
            url=self._url,
            port=self._port,
            error=self._error,
            ltx_data_path=str(paths.ltx_data_path),
            ltx_models_path=str(paths.ltx_models_path),
            input_path=str(paths.input_path),
            output_path=str(paths.output_path),
            user_path=str(paths.user_path),
        )

    async def start(self) -> ComfyUIStatus:
        async with self._lock:
            if self._state == "running" and self._url and await self._probe(self._url):
                return self.status()

            if self._process is not None:
                self.stop()

            paths = self._build_paths()
            self._paths = paths

            main_py = paths.root_path / "main.py"
            if not main_py.exists():
                self._state = "error"
                self._error = f"ComfyUI was not found at {paths.root_path}"
                return self.status()

            port = _free_port(8188)
            url = f"http://127.0.0.1:{port}"
            args = [
                "--listen",
                "127.0.0.1",
                "--port",
                str(port),
                "--input-directory",
                str(paths.input_path),
                "--output-directory",
                str(paths.output_path),
                "--temp-directory",
                str(paths.temp_path),
                "--user-directory",
                str(paths.user_path),
                "--extra-model-paths-config",
                str(paths.extra_model_paths_config),
                "--disable-auto-launch",
                "--enable-cors-header",
                "*",
                "--log-stdout",
            ]
            if _should_force_cpu_mode():
                args.append("--cpu")
            command = _build_launch_command(
                project_root=self._project_root,
                root_path=paths.root_path,
                main_py=main_py,
                ltx_video_custom_node_path=paths.ltx_video_custom_node_path,
                comfy_args=args,
            )

            self._state = "starting"
            self._url = url
            self._port = port
            self._error = None
            logger.info("Starting ComfyUI: %s", " ".join(command))

            process = subprocess.Popen(
                command,
                cwd=str(paths.root_path),
                env={
                    **os.environ,
                    "PYTHONUNBUFFERED": "1",
                    "HF_HUB_DISABLE_TELEMETRY": "1",
                    "DO_NOT_TRACK": "1",
                    "LTX_MEDIA_ROOT": str(paths.ltx_data_path),
                    "LTX_MODELS_DIR": str(paths.ltx_models_path),
                    "PYTORCH_ENABLE_MPS_FALLBACK": "1",
                },
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
            self._process = process
            _stream_process_logs(process)

            ready = await self._wait_ready(url, timeout_seconds=300)
            if not ready:
                exit_code = process.poll()
                self._state = "error"
                self._error = (
                    f"ComfyUI exited during startup with code {exit_code}"
                    if exit_code is not None
                    else "ComfyUI did not become ready before the startup timeout."
                )
                if exit_code is None:
                    process.terminate()
                return self.status()

            self._state = "running"
            return self.status()

    def stop(self) -> None:
        if self._process is None:
            if self._state != "running":
                self._state = "stopped"
            return
        self._process.terminate()
        self._process = None
        self._state = "stopped"
        self._url = None
        self._port = None
        self._error = None

    def _default_paths(self) -> ComfyUIPaths:
        root_path = self._project_root / "ComfyUI"
        return ComfyUIPaths(
            root_path=root_path,
            ltx_video_custom_node_path=root_path / "custom_nodes" / "ComfyUI-LTXVideo",
            ltx_data_path=self._data_dir,
            ltx_models_path=self._models_dir,
            input_path=self._data_dir,
            output_path=self._data_dir / "comfyui-output",
            temp_path=self._data_dir / ".comfyui-temp",
            user_path=self._data_dir / ".comfyui-user",
            extra_model_paths_config=self._app_data_dir / "comfyui" / "extra_model_paths.yaml",
        )

    def _build_paths(self) -> ComfyUIPaths:
        paths = self._default_paths()
        for directory in (
            paths.ltx_data_path,
            paths.ltx_models_path,
            paths.input_path,
            paths.output_path,
            paths.temp_path,
            paths.user_path,
            paths.extra_model_paths_config.parent,
        ):
            directory.mkdir(parents=True, exist_ok=True)
        _ensure_ltx_video_custom_node(self._project_root, paths.root_path)
        _write_extra_model_paths_config(paths.ltx_models_path, paths.extra_model_paths_config)
        return paths

    async def _probe(self, url: str) -> bool:
        return await asyncio.to_thread(_probe_url, url)

    async def _wait_ready(self, url: str, *, timeout_seconds: int) -> bool:
        started_at = time.monotonic()
        while time.monotonic() - started_at < timeout_seconds:
            if self._process is not None and self._process.poll() is not None:
                return False
            if await self._probe(url):
                return True
            await asyncio.sleep(1)
        return False


def _free_port(start_port: int) -> int:
    port = start_port
    while True:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            try:
                sock.bind(("127.0.0.1", port))
                return int(sock.getsockname()[1])
            except OSError:
                port += 1


def _probe_url(url: str) -> bool:
    try:
        request = Request(url, method="GET")
        with urlopen(request, timeout=1.2) as response:
            return 200 <= response.status < 500
    except Exception:
        return False


def _should_force_cpu_mode() -> bool:
    try:
        import torch

        return not bool(torch.cuda.is_available())
    except Exception:
        logger.warning("Could not inspect CUDA availability for ComfyUI startup", exc_info=True)
        return False


def _copy_ltx_video_custom_node(source_path: Path, target_path: Path) -> None:
    def ignore_git(dir_path: str, names: list[str]) -> set[str]:
        del dir_path
        return {name for name in names if name == ".git" or name == "__pycache__" or name.endswith(".pyc")}

    shutil.copytree(source_path, target_path, dirs_exist_ok=True, ignore=ignore_git)


def _ensure_ltx_video_custom_node(project_root: Path, comfyui_root: Path) -> Path:
    target_path = comfyui_root / "custom_nodes" / "ComfyUI-LTXVideo"
    source_path = project_root / "ComfyUI-LTXVideo"
    target_path.parent.mkdir(parents=True, exist_ok=True)

    if source_path.exists() and source_path.resolve() != target_path.resolve():
        _copy_ltx_video_custom_node(source_path, target_path)

    if not (target_path / "__init__.py").exists():
        expected_paths = f"{target_path}"
        if not source_path.exists():
            expected_paths = f"{expected_paths} or {source_path}"
        raise RuntimeError(f"ComfyUI-LTXVideo was not found. Expected it at {expected_paths}")

    return target_path


def _is_source_tree(project_root: Path) -> bool:
    return (project_root / "package.json").exists() and (project_root / "backend" / "pyproject.toml").exists()


def _build_launch_command(
    *,
    project_root: Path,
    root_path: Path,
    main_py: Path,
    ltx_video_custom_node_path: Path,
    comfy_args: list[str],
) -> list[str]:
    uv_path = shutil.which("uv")
    if uv_path and _is_source_tree(project_root):
        requirement_args = ["--with-requirements", str(root_path / "requirements.txt")]
        ltx_video_requirements = ltx_video_custom_node_path / "requirements.txt"
        if ltx_video_requirements.exists():
            requirement_args.extend(["--with-requirements", str(ltx_video_requirements)])
        return [
            uv_path,
            "run",
            "--project",
            str(project_root / "backend"),
            *requirement_args,
            "python",
            "-u",
            str(main_py),
            *comfy_args,
        ]

    return [sys.executable, "-u", str(main_py), *comfy_args]


def _json_string(value: Path) -> str:
    return json.dumps(str(value).replace("\\", "/"))


def _write_extra_model_paths_config(models_dir: Path, config_path: Path) -> None:
    body = "\n".join(
        [
            "# Generated by LTX Desktop. Do not edit while the app is running.",
            "ltx_models:",
            f"  base_path: {_json_string(models_dir)}",
            "  is_default: true",
            "  checkpoints: |",
            "    .",
            "    checkpoints",
            "  diffusion_models: |",
            "    .",
            "    diffusion_models",
            "    unet",
            "  loras: |",
            "    .",
            "    loras",
            "  text_encoders: |",
            "    gemma-3-12b-it-qat-q4_0-unquantized",
            "    text_encoders",
            "    clip",
            "  vae: |",
            "    vae",
            "  clip_vision: |",
            "    clip_vision",
            "  style_models: |",
            "    style_models",
            "  embeddings: |",
            "    embeddings",
            "  diffusers: |",
            "    diffusers",
            "    Z-Image-Turbo",
            "  vae_approx: |",
            "    vae_approx",
            "  controlnet: |",
            "    controlnet",
            "    t2i_adapter",
            "  gligen: |",
            "    gligen",
            "  upscale_models: |",
            "    .",
            "    upscale_models",
            "  latent_upscale_models: |",
            "    latent_upscale_models",
            "  hypernetworks: |",
            "    hypernetworks",
            "  photomaker: |",
            "    photomaker",
            "  classifiers: |",
            "    classifiers",
            "  model_patches: |",
            "    model_patches",
            "  audio_encoders: |",
            "    audio_encoders",
            "  background_removal: |",
            "    background_removal",
            "  frame_interpolation: |",
            "    frame_interpolation",
            "  geometry_estimation: |",
            "    geometry_estimation",
            "  optical_flow: |",
            "    optical_flow",
            "  detection: |",
            "    detection",
            "",
        ]
    )
    config_path.write_text(body, encoding="utf-8")


def _stream_process_logs(process: subprocess.Popen[str]) -> None:
    import threading

    def _read_output() -> None:
        if process.stdout is None:
            return
        for line in process.stdout:
            logger.info("[ComfyUI] %s", line.rstrip())

    thread = threading.Thread(target=_read_output, daemon=True)
    thread.start()
