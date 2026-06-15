"""Tests for /api/runtime-policy endpoint."""

from __future__ import annotations


def test_runtime_policy_true(client, test_state):
    test_state.config.force_api_generations = True

    response = client.get("/api/runtime-policy")
    assert response.status_code == 200
    body = response.json()
    assert body["force_api_generations"] is True
    assert body["offline_mode"] is False
    assert body["data_dir"] == str(test_state.config.app_data_dir)


def test_runtime_policy_false(client, test_state):
    test_state.config.force_api_generations = False

    response = client.get("/api/runtime-policy")
    assert response.status_code == 200
    body = response.json()
    assert body["force_api_generations"] is False
    assert body["offline_mode"] is False
    assert body["data_dir"] == str(test_state.config.app_data_dir)
