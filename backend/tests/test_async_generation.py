"""Tests for the non-blocking (async) generation contract and GPU OOM tagging."""

from __future__ import annotations

from pathlib import Path

from server_utils.gpu_errors import GPU_OOM_ERROR_PREFIX, is_out_of_memory_error, normalize_generation_error

_T2V_JSON = {
    "prompt": "test",
    "resolution": "540p",
    "model": "fast",
    "duration": "2",
    "fps": "24",
    "cameraMotion": "none",
}


def _enable_local_text_encoding(test_state) -> None:
    test_state.state.app_settings.use_local_text_encoder = True


class TestAsyncGenerationContract:
    def test_progress_exposes_video_path_on_complete(self, client, test_state, create_fake_model_files):
        create_fake_model_files()
        _enable_local_text_encoding(test_state)

        r = client.post("/api/generate", json=_T2V_JSON)
        assert r.status_code == 200

        # With the inline test task runner the job has already finished, so the
        # progress endpoint must expose the terminal result for async pollers.
        progress = client.get("/api/generation/progress")
        assert progress.status_code == 200
        data = progress.json()
        assert data["status"] == "complete"
        assert data["videoPath"] is not None
        assert Path(data["videoPath"]).exists()

    def test_progress_exposes_image_paths_on_complete(self, client, test_state, create_fake_model_files):
        create_fake_model_files(include_zit=True)
        _enable_local_text_encoding(test_state)

        r = client.post(
            "/api/generate-image",
            json={"prompt": "a cat", "width": 512, "height": 512, "numSteps": 4, "numImages": 1},
        )
        assert r.status_code == 200

        data = client.get("/api/generation/progress").json()
        assert data["status"] == "complete"
        assert data["imagePaths"]
        assert all(Path(p).exists() for p in data["imagePaths"])

    def test_error_progress_exposes_message(self, client, test_state, fake_services, create_fake_model_files):
        create_fake_model_files()
        _enable_local_text_encoding(test_state)
        fake_services.fast_video_pipeline.raise_on_generate = RuntimeError("boom")

        r = client.post("/api/generate", json=_T2V_JSON)
        assert r.status_code == 500

        data = client.get("/api/generation/progress").json()
        assert data["status"] == "error"
        assert "boom" in (data["error"] or "")

    def test_oom_error_is_tagged_for_the_ui(self, client, test_state, fake_services, create_fake_model_files):
        create_fake_model_files()
        _enable_local_text_encoding(test_state)
        fake_services.fast_video_pipeline.raise_on_generate = RuntimeError("CUDA out of memory. Tried to allocate ...")

        r = client.post("/api/generate", json=_T2V_JSON)
        assert r.status_code == 500

        data = client.get("/api/generation/progress").json()
        assert data["status"] == "error"
        assert GPU_OOM_ERROR_PREFIX in (data["error"] or "")


class TestGpuErrorClassification:
    def test_detects_cuda_oom(self) -> None:
        assert is_out_of_memory_error("CUDA out of memory. Tried to allocate 2.00 GiB")

    def test_detects_oom_error_type(self) -> None:
        class OutOfMemoryError(RuntimeError):
            pass

        assert is_out_of_memory_error(OutOfMemoryError("no free memory"))

    def test_passes_through_non_oom(self) -> None:
        assert not is_out_of_memory_error("model failed to load")
        assert normalize_generation_error("model failed to load") == "model failed to load"

    def test_tags_oom_once(self) -> None:
        tagged = normalize_generation_error("cuda out of memory")
        assert tagged.startswith(GPU_OOM_ERROR_PREFIX)
        # Idempotent: re-normalising does not double-prefix.
        assert normalize_generation_error(tagged) == tagged
