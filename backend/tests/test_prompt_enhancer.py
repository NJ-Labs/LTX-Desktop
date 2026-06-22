"""Integration-style tests for /api/prompt-enhancer (enhance + test connection)."""

from __future__ import annotations

from services.interfaces import HttpTimeoutError
from tests.fakes import FakeResponse

BASE_URL = "http://localhost:1234/v1"


def _chat_ok(text: str = "An enhanced cinematic prompt.") -> FakeResponse:
    return FakeResponse(
        status_code=200,
        json_payload={"choices": [{"message": {"role": "assistant", "content": text}}]},
    )


def _models_ok(*model_ids: str) -> FakeResponse:
    return FakeResponse(
        status_code=200,
        json_payload={"data": [{"id": mid, "object": "model"} for mid in model_ids]},
    )


def _configure(test_state, *, base_url: str = BASE_URL, api_key: str = "secret-key", model: str = "my-model") -> None:
    test_state.state.app_settings.prompt_enhancer_base_url = base_url
    test_state.state.app_settings.prompt_enhancer_api_key = api_key
    test_state.state.app_settings.prompt_enhancer_model = model


class TestEnhancePrompt:
    def test_streams_openai_content_deltas(self, client, test_state):
        _configure(test_state)
        test_state.http.queue(
            "stream_post",
            FakeResponse(
                lines=[
                    b'data: {"choices":[{"delta":{"content":"A cinematic "}}]}',
                    b'data: {"choices":[{"delta":{"content":"sunrise."}}]}',
                    b"data: [DONE]",
                ]
            ),
        )

        with client.stream(
            "POST",
            "/api/prompt-enhancer/enhance/stream",
            json={"prompt": "sunrise", "mode": "video"},
        ) as response:
            assert response.status_code == 200
            assert response.iter_lines() == [
                '{"delta": "A cinematic "}',
                '{"delta": "sunrise."}',
            ]

        call = test_state.http.calls[-1]
        assert call.method == "stream_post"
        assert call.json_payload is not None
        assert call.json_payload["stream"] is True

    def test_video_happy_path(self, client, test_state):
        _configure(test_state)
        test_state.http.queue("post", _chat_ok("A lone astronaut drifts past a glowing nebula."))

        r = client.post(
            "/api/prompt-enhancer/enhance",
            json={"prompt": "astronaut in space", "mode": "video"},
        )
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "success"
        assert data["enhanced_prompt"] == "A lone astronaut drifts past a glowing nebula."

        call = test_state.http.calls[-1]
        assert call.url == "http://localhost:1234/v1/chat/completions"
        assert call.headers is not None
        assert call.headers.get("Authorization") == "Bearer secret-key"
        assert call.json_payload is not None
        assert call.json_payload["model"] == "my-model"
        system_message = call.json_payload["messages"][0]
        assert system_message["role"] == "system"
        assert "LTX 2.3" in system_message["content"]
        user_message = call.json_payload["messages"][1]
        assert user_message["content"] == "astronaut in space"

    def test_image_mode_uses_image_instructions(self, client, test_state):
        _configure(test_state)
        test_state.http.queue("post", _chat_ok("A serene portrait bathed in golden light."))

        r = client.post(
            "/api/prompt-enhancer/enhance",
            json={"prompt": "a woman", "mode": "image"},
        )
        assert r.status_code == 200

        call = test_state.http.calls[-1]
        system_message = call.json_payload["messages"][0]
        assert "Z-Image-Turbo" in system_message["content"]

    def test_strips_wrapping_quotes(self, client, test_state):
        _configure(test_state)
        test_state.http.queue("post", _chat_ok('"Quoted enhanced prompt."'))

        r = client.post("/api/prompt-enhancer/enhance", json={"prompt": "x", "mode": "video"})
        assert r.status_code == 200
        assert r.json()["enhanced_prompt"] == "Quoted enhanced prompt."

    def test_no_api_key_omits_authorization(self, client, test_state):
        _configure(test_state, api_key="")
        test_state.http.queue("post", _chat_ok())

        r = client.post("/api/prompt-enhancer/enhance", json={"prompt": "x", "mode": "video"})
        assert r.status_code == 200
        call = test_state.http.calls[-1]
        assert "Authorization" not in (call.headers or {})

    def test_not_configured_400(self, client):
        r = client.post("/api/prompt-enhancer/enhance", json={"prompt": "x", "mode": "video"})
        assert r.status_code == 400
        assert r.json()["error"] == "PROMPT_ENHANCER_NOT_CONFIGURED"

    def test_blank_prompt_422(self, client, test_state):
        _configure(test_state)
        r = client.post("/api/prompt-enhancer/enhance", json={"prompt": "   ", "mode": "video"})
        assert r.status_code == 422

    def test_timeout_504(self, client, test_state):
        _configure(test_state)
        test_state.http.queue("post", HttpTimeoutError("timeout"))

        r = client.post("/api/prompt-enhancer/enhance", json={"prompt": "x", "mode": "video"})
        assert r.status_code == 504

    def test_upstream_error_propagates_status(self, client, test_state):
        _configure(test_state)
        test_state.http.queue("post", FakeResponse(status_code=401, text="invalid api key"))

        r = client.post("/api/prompt-enhancer/enhance", json={"prompt": "x", "mode": "video"})
        assert r.status_code == 401

    def test_empty_response_502(self, client, test_state):
        _configure(test_state)
        test_state.http.queue("post", _chat_ok(""))

        r = client.post("/api/prompt-enhancer/enhance", json={"prompt": "x", "mode": "video"})
        assert r.status_code == 502


class TestPromptEnhancerConnection:
    def test_uses_saved_settings(self, client, test_state):
        _configure(test_state, model="my-model")
        test_state.http.queue("get", _models_ok("my-model", "other-model"))

        r = client.post("/api/prompt-enhancer/test", json={})
        assert r.status_code == 200
        assert r.json()["status"] == "success"

        call = test_state.http.calls[-1]
        assert call.method == "get"
        assert call.url == "http://localhost:1234/v1/models"
        assert call.headers.get("Authorization") == "Bearer secret-key"

    def test_overrides_take_precedence(self, client, test_state):
        # Nothing saved; values supplied in the request body should be used.
        test_state.http.queue("get", _models_ok("override-model"))

        r = client.post(
            "/api/prompt-enhancer/test",
            json={"baseUrl": "http://127.0.0.1:5000/v1/", "apiKey": "override-key", "model": "override-model"},
        )
        assert r.status_code == 200

        call = test_state.http.calls[-1]
        assert call.url == "http://127.0.0.1:5000/v1/models"
        assert call.headers.get("Authorization") == "Bearer override-key"

    def test_model_not_found_still_succeeds_with_note(self, client, test_state):
        _configure(test_state, model="missing-model")
        test_state.http.queue("get", _models_ok("a", "b"))

        r = client.post("/api/prompt-enhancer/test", json={})
        assert r.status_code == 200
        assert "not found" in r.json()["message"]

    def test_not_configured_400(self, client):
        r = client.post("/api/prompt-enhancer/test", json={})
        assert r.status_code == 400
        assert r.json()["error"] == "PROMPT_ENHANCER_NOT_CONFIGURED"

    def test_connection_failure_propagates(self, client, test_state):
        _configure(test_state)
        test_state.http.queue("get", FakeResponse(status_code=404, text="not found"))

        r = client.post("/api/prompt-enhancer/test", json={})
        assert r.status_code == 404
