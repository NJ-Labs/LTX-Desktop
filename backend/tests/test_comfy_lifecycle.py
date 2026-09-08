"""Managed ComfyUI process lifecycle regression tests."""

import asyncio
from pathlib import Path

from services.comfyui_service import ComfyUIService


def test_stop_aborts_startup_without_late_error(tmp_path: Path, monkeypatch) -> None:
    project_root = tmp_path / "runtime"
    comfy_root = project_root / "ComfyUI"
    (comfy_root / "custom_nodes" / "ComfyUI-LTXVideo").mkdir(parents=True)
    (comfy_root / "custom_nodes" / "ComfyUI-LTXVideo" / "__init__.py").write_text("", encoding="utf-8")
    (comfy_root / "custom_nodes" / "ltx_studio_bridge").mkdir(parents=True)
    (comfy_root / "custom_nodes" / "ltx_studio_bridge" / "__init__.py").write_text("", encoding="utf-8")
    (comfy_root / "main.py").write_text(
        "import time\ntime.sleep(60)\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("LTX_COMFYUI_CPU", "1")
    service = ComfyUIService(
        project_root=project_root,
        app_data_dir=tmp_path / "app-data",
        data_dir=tmp_path / "media",
        models_dir=tmp_path / "models",
    )

    async def exercise() -> None:
        startup = asyncio.create_task(service.start())
        for _ in range(200):
            if service._process is not None:
                break
            await asyncio.sleep(0.01)
        process = service._process
        assert process is not None, "test ComfyUI process did not start"

        await asyncio.to_thread(service.stop)
        result = await asyncio.wait_for(startup, timeout=2)

        assert result.state == "stopped"
        assert service.status().state == "stopped"
        assert process.poll() is not None

    asyncio.run(exercise())
