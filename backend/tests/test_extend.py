"""Public-boundary regressions for true temporal video extension."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import torch

from services.retake_pipeline.ltx_retake_pipeline import LTXRetakePipeline


def _make_video(path: Path, *, frames: int = 10, fps: float = 24, width: int = 64) -> None:
    import imageio.v2 as imageio
    import numpy as np

    writer = imageio.get_writer(str(path), fps=fps, codec="libx264", macro_block_size=None)
    frame = np.zeros((64, width, 3), dtype=np.uint8)
    for _ in range(frames):
        writer.append_data(frame)
    writer.close()


def test_local_extend_forwards_temporal_prefix_contract(
    client,
    test_state,
    fake_services,
    create_fake_model_files,
    tmp_path,
) -> None:
    create_fake_model_files(include_zit=False)
    test_state.state.app_settings.use_local_text_encoder = True
    source = tmp_path / "source.mp4"
    _make_video(source)

    response = client.post(
        "/api/extend",
        json={"video_path": str(source), "duration": 2, "prompt": "continue walking", "mode": "end"},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "complete"
    call = fake_services.retake_pipeline.extend_calls[0]
    assert call["video_path"] == str(source)
    assert call["mode"] == "end"
    assert call["target_frames"] == 9
    assert call["extend_frames"] == 48
    assert Path(response.json()["video_path"]).read_bytes() == b"fake-extended-video"
    assert test_state.state.native_run_id is None


def test_extend_limits_use_authoritative_frame_grid(client, tmp_path) -> None:
    source = tmp_path / "source.mp4"
    _make_video(source, frames=10, fps=24)

    response = client.get("/api/extend/limits", params={"video_path": str(source)})

    assert response.status_code == 200
    payload = response.json()
    assert payload["fps"] == 24.0
    assert payload["source_frames"] == 10
    assert payload["corrected_source_frames"] == 9
    assert payload["max_additional_seconds"] == 472 / 24
    assert payload["minimum_additional_seconds"] == 2.0
    assert payload["can_extend"] is True


def test_extend_rejects_remote_generation_mode(client, test_state, tmp_path) -> None:
    test_state.config.force_api_generations = True
    test_state.state.app_settings.ltx_api_key = "key"
    source = tmp_path / "source.mp4"
    source.write_bytes(b"video")

    response = client.post(
        "/api/extend",
        json={"video_path": str(source), "duration": 2, "prompt": "continue", "mode": "end"},
    )

    assert response.status_code == 409
    assert response.json()["error"] == "LOCAL_EXTEND_REQUIRES_LOCAL_GENERATION"


def test_extend_duration_contract_is_validated(client, tmp_path) -> None:
    source = tmp_path / "source.mp4"
    source.write_bytes(b"video")

    response = client.post(
        "/api/extend",
        json={"video_path": str(source), "duration": 1, "prompt": "continue", "mode": "end"},
    )

    assert response.status_code == 422


def test_temporal_padding_preserves_source_as_prefix_or_suffix() -> None:
    latent = torch.tensor([[[[[1.0]], [[2.0]]]]])

    appended = LTXRetakePipeline._pad_latent_frames(latent, 1, "end")
    prepended = LTXRetakePipeline._pad_latent_frames(latent, 1, "start")

    assert appended.flatten().tolist() == [1.0, 2.0, 0.0]
    assert prepended.flatten().tolist() == [0.0, 1.0, 2.0]


def test_extend_rejects_unsupported_source_dimensions(client, test_state, tmp_path) -> None:
    test_state.state.app_settings.use_local_text_encoder = True
    source = tmp_path / "bad-size.mp4"
    _make_video(source, width=62)

    response = client.post(
        "/api/extend",
        json={"video_path": str(source), "duration": 2, "prompt": "continue", "mode": "end"},
    )

    assert response.status_code == 400
    assert "multiples of 32" in response.json()["error"]


def test_extend_rejects_non_integral_source_fps(client, test_state, tmp_path) -> None:
    test_state.state.app_settings.use_local_text_encoder = True
    source = tmp_path / "fractional-fps.mp4"
    _make_video(source, fps=23.976)

    response = client.post(
        "/api/extend",
        json={"video_path": str(source), "duration": 2, "prompt": "continue", "mode": "end"},
    )

    assert response.status_code == 400
    assert "integer source FPS" in response.json()["error"]


def test_extend_rejects_total_duration_above_local_limit(client, test_state, tmp_path) -> None:
    test_state.state.app_settings.use_local_text_encoder = True
    source = tmp_path / "long.mp4"
    _make_video(source, frames=450)

    response = client.post(
        "/api/extend",
        json={"video_path": str(source), "duration": 2, "prompt": "continue", "mode": "end"},
    )

    assert response.status_code == 400
    assert "at most 20 seconds total" in response.json()["error"]

    limits = client.get("/api/extend/limits", params={"video_path": str(source)})
    assert limits.status_code == 200
    assert limits.json()["max_additional_seconds"] == 32 / 24
    assert limits.json()["can_extend"] is False


def test_extend_failure_removes_partial_output_and_releases_lease(
    client,
    test_state,
    fake_services,
    create_fake_model_files,
    tmp_path,
) -> None:
    create_fake_model_files(include_zit=False)
    test_state.state.app_settings.use_local_text_encoder = True
    fake_services.retake_pipeline.raise_on_generate = RuntimeError("codec failed")
    source = tmp_path / "source.mp4"
    _make_video(source)

    response = client.post(
        "/api/extend",
        json={"video_path": str(source), "duration": 2, "prompt": "continue", "mode": "end"},
    )

    assert response.status_code == 500
    assert list(test_state.config.outputs_dir.glob("extend_*.mp4")) == []
    assert test_state.state.native_run_id is None


def test_cancelled_extend_holds_lease_until_worker_exits(
    client,
    test_state,
    fake_services,
    create_fake_model_files,
    tmp_path,
) -> None:
    create_fake_model_files(include_zit=False)
    test_state.state.app_settings.use_local_text_encoder = True
    pipeline = fake_services.retake_pipeline
    pipeline.block_extend = True
    pipeline.raise_on_generate = RuntimeError("driver aborted")
    source = tmp_path / "source.mp4"
    _make_video(source)
    payload = {"video_path": str(source), "duration": 2, "prompt": "continue", "mode": "end"}

    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(client.post, "/api/extend", json=payload)
        assert pipeline.extend_entered.wait(timeout=2)
        cancelled = client.post("/api/generate/cancel")
        assert cancelled.status_code == 200
        assert cancelled.json()["status"] == "cancelling"
        assert test_state.generation.try_reserve_generation("competitor") is False
        pipeline.allow_extend.set()
        response = pending.result(timeout=5)

    assert response.status_code == 200
    assert response.json()["status"] == "cancelled"
    assert test_state.generation.get_generation_progress().status == "cancelled"
    assert list(test_state.config.outputs_dir.glob("extend_*.mp4")) == []
    assert test_state.state.native_run_id is None
