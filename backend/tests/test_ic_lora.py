"""Integration-style tests for IC-LoRA endpoints."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import time

from runtime_config.model_download_specs import resolve_model_path
from tests.fakes import FakeCapture


def _model_path(test_state, model_type: str) -> Path:
    return resolve_model_path(
        test_state.config.default_models_dir,
        test_state.config.model_download_specs,
        model_type,
    )


def _create_ic_lora_resources(
    test_state,
    *,
    include_depth: bool = True,
    include_pose: bool = False,
    adapter_type: str = "union",
) -> None:
    model_type = "ic_lora_ingredients" if adapter_type == "ingredients" else "ic_lora"
    ic_lora_path = _model_path(test_state, model_type)
    ic_lora_path.parent.mkdir(parents=True, exist_ok=True)
    ic_lora_path.write_bytes(b"\x00" * 100)

    if include_depth:
        depth_path = _model_path(test_state,"depth_processor")
        depth_path.parent.mkdir(parents=True, exist_ok=True)
        depth_path.write_bytes(b"\x00" * 100)

    if include_pose:
        for pose_model_type in ("person_detector", "pose_processor"):
            pose_path = _model_path(test_state, pose_model_type)
            pose_path.parent.mkdir(parents=True, exist_ok=True)
            pose_path.write_bytes(b"\x00" * 100)


class TestIcLoraDownload:
    def test_start_download_when_missing(self, client, test_state):
        response = client.post("/api/models/download", json={"modelTypes": ["ic_lora"]})
        assert response.status_code == 200
        assert response.json()["status"] == "started"
        assert _model_path(test_state,"ic_lora").exists()

        ic_lora_spec = test_state.config.spec_for("ic_lora")
        file_calls = [call for call in test_state.model_downloader.calls if call["kind"] == "file"]
        assert file_calls
        assert any(call["filename"] == ic_lora_spec.name for call in file_calls)

    def test_download_ingredients_adapter(self, client, test_state):
        response = client.post("/api/models/download", json={"modelTypes": ["ic_lora_ingredients"]})

        assert response.status_code == 200
        ingredients_spec = test_state.config.spec_for("ic_lora_ingredients")
        file_calls = [call for call in test_state.model_downloader.calls if call["kind"] == "file"]
        assert any(
            call["repo_id"] == ingredients_spec.repo_id and call["filename"] == ingredients_spec.name
            for call in file_calls
        )

    def test_already_downloaded(self, client, test_state):
        ic_lora_path = _model_path(test_state,"ic_lora")
        ic_lora_path.parent.mkdir(parents=True, exist_ok=True)
        ic_lora_path.write_bytes(b"\x00" * 2048)

        response = client.post("/api/models/download", json={"modelTypes": ["ic_lora"]})
        assert response.status_code == 200
        assert response.json()["status"] == "started"

    def test_conflict_when_download_in_progress(self, client, test_state):
        test_state.downloads.start_download({"checkpoint"})
        response = client.post("/api/models/download", json={"modelTypes": ["ic_lora"]})
        assert response.status_code == 409

    def test_download_error_propagates_to_progress(self, client, test_state):
        test_state.model_downloader.fail_next = RuntimeError("Connection refused")

        response = client.post("/api/models/download", json={"modelTypes": ["ic_lora"]})
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "started"
        session_id = data["sessionId"]

        progress = client.get("/api/models/download/progress", params={"sessionId": session_id})
        assert progress.status_code == 200
        assert progress.json()["status"] == "error"


class TestIcLoraExtractConditioning:
    def test_canny_extraction(self, client, test_state):
        video_path = test_state.config.outputs_dir / "test_video.mp4"
        video_path.write_bytes(b"\x00" * 100)
        test_state.video_processor.register_video(str(video_path), FakeCapture(frames=["frame-a"]))

        response = client.post(
            "/api/ic-lora/extract-conditioning",
            json={"video_path": str(video_path), "conditioning_type": "canny", "frame_time": 0},
        )
        assert response.status_code == 200
        payload = response.json()
        assert payload["conditioning_type"] == "canny"
        assert payload["conditioning"].startswith("data:image/jpeg;base64,")

    def test_depth_extraction(self, client, test_state, fake_services):
        video_path = test_state.config.outputs_dir / "test_video.mp4"
        video_path.write_bytes(b"\x00" * 100)
        _create_ic_lora_resources(test_state)
        test_state.video_processor.register_video(str(video_path), FakeCapture(frames=["frame-a"]))

        response = client.post(
            "/api/ic-lora/extract-conditioning",
            json={"video_path": str(video_path), "conditioning_type": "depth", "frame_time": 0},
        )
        assert response.status_code == 200
        assert response.json()["conditioning_type"] == "depth"
        assert fake_services.depth_processor_pipeline.apply_calls == ["frame-a"]

    def test_depth_extraction_rejects_comfy_gpu_lease(self, client, test_state):
        video_path = test_state.config.outputs_dir / "depth_busy.mp4"
        video_path.write_bytes(b"fake")
        test_state.video_processor.register_video(str(video_path), FakeCapture(frames=["frame-a"]))
        assert test_state.generation.try_reserve_comfy("comfy-1") is True

        response = client.post(
            "/api/ic-lora/extract-conditioning",
            json={"video_path": str(video_path), "conditioning_type": "depth", "frame_time": 0},
        )

        assert response.status_code == 409
        test_state.generation.release_comfy("comfy-1")

    def test_pose_extraction(self, client, test_state, fake_services):
        video_path = test_state.config.outputs_dir / "pose_video.mp4"
        video_path.write_bytes(b"\x00" * 100)
        _create_ic_lora_resources(test_state, include_depth=False, include_pose=True)
        test_state.video_processor.register_video(str(video_path), FakeCapture(frames=["frame-a"]))

        response = client.post(
            "/api/ic-lora/extract-conditioning",
            json={"video_path": str(video_path), "conditioning_type": "pose", "frame_time": 0},
        )

        assert response.status_code == 200
        assert response.json()["conditioning_type"] == "pose"
        assert fake_services.pose_processor_pipeline.apply_calls == ["frame-a"]

    def test_rejects_unsupported_conditioning_type(self, client, test_state):
        video_path = test_state.config.outputs_dir / "test_video.mp4"
        video_path.write_bytes(b"\x00" * 100)
        response = client.post(
            "/api/ic-lora/extract-conditioning",
            json={"video_path": str(video_path), "conditioning_type": "unknown", "frame_time": 0},
        )
        assert response.status_code == 422

    def test_unreadable_frame(self, client, test_state):
        video_path = test_state.config.outputs_dir / "bad_video.mp4"
        video_path.write_bytes(b"\x00" * 100)
        test_state.video_processor.register_video(str(video_path), FakeCapture(frames=[]))

        response = client.post(
            "/api/ic-lora/extract-conditioning",
            json={"video_path": str(video_path), "conditioning_type": "canny"},
        )
        assert response.status_code == 400


class TestIcLoraGenerate:
    def test_concurrent_requests_reserve_before_pipeline_load(
        self,
        client,
        test_state,
        fake_services,
    ):
        video_path = test_state.config.outputs_dir / "concurrent_input.mp4"
        video_path.write_bytes(b"\x00" * 100)
        _create_ic_lora_resources(test_state)

        text_encoder_dir = _model_path(test_state, "text_encoder")
        text_encoder_dir.mkdir(parents=True, exist_ok=True)
        (text_encoder_dir / "model.safetensors").write_bytes(b"\x00" * 100)
        test_state.state.app_settings.use_local_text_encoder = True

        test_state.video_processor.register_video(
            str(video_path),
            FakeCapture(frames=["f1", "f2"], fps=24, width=64, height=64),
        )
        pipeline = fake_services.ic_lora_pipeline
        pipeline.block_create = True
        payload = {
            "video_path": str(video_path),
            "prompt": "test prompt",
            "conditioning_type": "canny",
            "seed": 42,
        }

        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(client.post, "/api/ic-lora/generate", json=payload)
            assert pipeline.create_entered.wait(timeout=2)
            second = pool.submit(client.post, "/api/ic-lora/generate", json=payload)
            time.sleep(0.1)
            pipeline.allow_create.set()
            responses = [first.result(timeout=5), second.result(timeout=5)]

        assert sorted(response.status_code for response in responses) == [200, 409]
        assert len(pipeline.create_calls) == 1

    def test_happy_path(self, client, test_state, fake_services):
        video_path = test_state.config.outputs_dir / "input.mp4"
        video_path.write_bytes(b"\x00" * 100)
        _create_ic_lora_resources(test_state)

        te_dir = _model_path(test_state,"text_encoder")
        te_dir.mkdir(parents=True, exist_ok=True)
        (te_dir / "model.safetensors").write_bytes(b"\x00" * 100)
        test_state.state.app_settings.use_local_text_encoder = True

        capture = FakeCapture(frames=["f1", "f2"], fps=24, width=64, height=64)
        test_state.video_processor.register_video(str(video_path), capture)

        response = client.post(
            "/api/ic-lora/generate",
            json={
                "video_path": str(video_path),
                "prompt": "test prompt",
                "conditioning_type": "canny",
                "seed": 42,
            },
        )

        assert response.status_code == 200
        payload = response.json()
        assert payload["status"] == "complete"
        assert Path(payload["video_path"]).exists()

        pipeline = fake_services.ic_lora_pipeline
        assert len(pipeline.generate_calls) == 1

    def test_ingredients_reference_sheet_with_character_anchor(self, client, test_state, fake_services):
        reference_path = test_state.config.outputs_dir / "reference-sheet.png"
        reference_path.write_bytes(b"fake-image")
        anchor_path = test_state.config.outputs_dir / "face-anchor.png"
        anchor_path.write_bytes(b"fake-anchor")
        _create_ic_lora_resources(test_state, include_depth=False, adapter_type="ingredients")
        te_dir = _model_path(test_state, "text_encoder")
        te_dir.mkdir(parents=True, exist_ok=True)
        (te_dir / "model.safetensors").write_bytes(b"fake")
        test_state.state.app_settings.use_local_text_encoder = True

        response = client.post(
            "/api/ic-lora/generate",
            json={
                "video_path": str(reference_path),
                "adapter_type": "ingredients",
                "conditioning_type": "reference_sheet",
                "prompt": "the character walks through a market",
                "conditioning_strength": 1.1,
                "attention_strength": 0.85,
                "images": [{"path": str(anchor_path), "frame": 0, "strength": 0.9}],
            },
        )

        assert response.status_code == 200
        assert len(test_state.video_processor.create_static_video_calls) == 1
        static_call = test_state.video_processor.create_static_video_calls[0]
        assert static_call["width"] == 768
        assert static_call["height"] == 448
        assert static_call["frame_count"] == 121
        assert static_call["fps"] == 24.0

        generate_call = fake_services.ic_lora_pipeline.generate_calls[0]
        assert fake_services.ic_lora_pipeline.create_calls[0]["lora_strength"] == 1.4
        assert generate_call["prompt"].startswith("Reference sheet:")
        assert "Generated video: the character walks" in generate_call["prompt"]
        assert generate_call["height"] == 448
        assert generate_call["width"] == 768
        assert generate_call["num_frames"] == 121
        assert generate_call["conditioning_attention_strength"] == 0.85
        assert generate_call["images"][0].path == str(anchor_path)
        assert generate_call["images"][0].strength == 0.9

    def test_pose_generation(self, client, test_state, fake_services):
        video_path = test_state.config.outputs_dir / "pose-input.mp4"
        video_path.write_bytes(b"\x00" * 100)
        _create_ic_lora_resources(test_state, include_depth=False, include_pose=True)
        te_dir = _model_path(test_state, "text_encoder")
        te_dir.mkdir(parents=True, exist_ok=True)
        (te_dir / "model.safetensors").write_bytes(b"fake")
        test_state.state.app_settings.use_local_text_encoder = True
        test_state.video_processor.register_video(
            str(video_path),
            FakeCapture(frames=["f1", "f2"], fps=24, width=64, height=64),
        )

        response = client.post(
            "/api/ic-lora/generate",
            json={"video_path": str(video_path), "prompt": "dance", "conditioning_type": "pose"},
        )

        assert response.status_code == 200
        assert fake_services.pose_processor_pipeline.apply_calls == ["f1", "f2"]

    def test_ingredients_requires_ingredients_model(self, client, test_state):
        reference_path = test_state.config.outputs_dir / "reference-sheet.png"
        reference_path.write_bytes(b"fake-image")

        response = client.post(
            "/api/ic-lora/generate",
            json={
                "video_path": str(reference_path),
                "adapter_type": "ingredients",
                "conditioning_type": "reference_sheet",
                "prompt": "walk",
            },
        )

        assert response.status_code == 400
        assert "Ingredients IC-LoRA model not found" in response.json()["error"]

    def test_adapter_and_conditioning_must_match(self, client, test_state):
        reference_path = test_state.config.outputs_dir / "reference-sheet.png"
        reference_path.write_bytes(b"fake-image")
        _create_ic_lora_resources(test_state, include_depth=False, adapter_type="ingredients")

        response = client.post(
            "/api/ic-lora/generate",
            json={
                "video_path": str(reference_path),
                "adapter_type": "ingredients",
                "conditioning_type": "canny",
                "prompt": "walk",
            },
        )

        assert response.status_code == 400
        assert "requires reference_sheet conditioning" in response.json()["error"]

    def test_attention_strength_above_pipeline_limit_is_rejected(self, client, test_state):
        video_path = test_state.config.outputs_dir / "input.mp4"
        video_path.write_bytes(b"\x00" * 100)

        response = client.post(
            "/api/ic-lora/generate",
            json={
                "video_path": str(video_path),
                "prompt": "walk",
                "conditioning_type": "canny",
                "attention_strength": 1.01,
            },
        )

        assert response.status_code == 422

    def test_video_not_found(self, client, test_state):
        _create_ic_lora_resources(test_state)

        response = client.post(
            "/api/ic-lora/generate",
            json={"video_path": "/nonexistent/video.mp4", "prompt": "test", "conditioning_type": "canny", "seed": 42},
        )
        assert response.status_code == 400

    def test_ic_lora_not_downloaded(self, client, test_state):
        video_path = test_state.config.outputs_dir / "input.mp4"
        video_path.write_bytes(b"\x00" * 100)

        response = client.post(
            "/api/ic-lora/generate",
            json={"video_path": str(video_path), "prompt": "test", "conditioning_type": "canny", "seed": 42},
        )
        assert response.status_code == 400
        assert "IC-LoRA model not found" in response.json()["error"]

    def test_empty_prompt_rejected(self, client, test_state):
        video_path = test_state.config.outputs_dir / "input.mp4"
        video_path.write_bytes(b"\x00" * 100)
        _create_ic_lora_resources(test_state)

        response = client.post(
            "/api/ic-lora/generate",
            json={"video_path": str(video_path), "prompt": "", "conditioning_type": "canny", "seed": 42},
        )
        assert response.status_code == 422

    def test_pipeline_error(self, client, test_state, fake_services):
        video_path = test_state.config.outputs_dir / "input.mp4"
        video_path.write_bytes(b"\x00" * 100)
        _create_ic_lora_resources(test_state)

        test_state.video_processor.register_video(str(video_path), FakeCapture(frames=["f1", "f2"]))
        fake_services.ic_lora_pipeline.raise_on_generate = RuntimeError("GPU OOM")

        response = client.post(
            "/api/ic-lora/generate",
            json={"video_path": str(video_path), "prompt": "test", "conditioning_type": "canny", "seed": 42},
        )
        assert response.status_code == 500

    def test_rejects_unsupported_conditioning_type(self, client, test_state):
        video_path = test_state.config.outputs_dir / "input.mp4"
        video_path.write_bytes(b"\x00" * 100)
        _create_ic_lora_resources(test_state)

        response = client.post(
            "/api/ic-lora/generate",
            json={"video_path": str(video_path), "prompt": "test", "conditioning_type": "unknown", "seed": 42},
        )
        assert response.status_code == 422

    def test_depth_processor_not_downloaded(self, client, test_state):
        video_path = test_state.config.outputs_dir / "input.mp4"
        video_path.write_bytes(b"\x00" * 100)
        _create_ic_lora_resources(test_state, include_depth=False)

        response = client.post(
            "/api/ic-lora/generate",
            json={"video_path": str(video_path), "prompt": "test", "conditioning_type": "depth", "seed": 42},
        )
        assert response.status_code == 400
        assert "Depth processor model not found" in response.json()["error"]

    def test_second_generation_reuses_conditioning_cache(self, client, test_state, fake_services):
        video_path = test_state.config.outputs_dir / "input.mp4"
        video_path.write_bytes(b"\x00" * 100)
        _create_ic_lora_resources(test_state)

        te_dir = _model_path(test_state,"text_encoder")
        te_dir.mkdir(parents=True, exist_ok=True)
        (te_dir / "model.safetensors").write_bytes(b"\x00" * 100)
        test_state.state.app_settings.use_local_text_encoder = True

        capture = FakeCapture(frames=["f1", "f2"], fps=24, width=64, height=64)
        test_state.video_processor.register_video(str(video_path), capture)

        payload = {
            "video_path": str(video_path),
            "prompt": "test prompt",
            "conditioning_type": "canny",
            "seed": 42,
        }

        r1 = client.post("/api/ic-lora/generate", json=payload)
        assert r1.status_code == 200

        writers_after_first = len(test_state.video_processor.writers)

        # Re-register the video so it can be opened again if needed
        capture2 = FakeCapture(frames=["f1", "f2"], fps=24, width=64, height=64)
        test_state.video_processor.register_video(str(video_path), capture2)

        r2 = client.post("/api/ic-lora/generate", json={**payload, "seed": 99})
        assert r2.status_code == 200

        # Cache hit: no new control video should have been written
        assert len(test_state.video_processor.writers) == writers_after_first
