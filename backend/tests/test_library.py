"""Integration tests for the persistent project library routes."""

from __future__ import annotations

import json


def test_get_library_empty_by_default(client):
    response = client.get("/api/library")
    assert response.status_code == 200
    assert response.json() == {"projects": [], "playgroundAssets": []}


def test_put_then_get_round_trips_projects_and_playground(client):
    payload = {
        "projects": [
            {
                "id": "project-1",
                "name": "My Film",
                "description": "A short film",
                "coverImage": "data:image/png;base64,AAAA",
                "assets": [{"id": "a1", "type": "video", "url": "/media?path=/data/outputs/x.mp4"}],
                "timelines": [{"id": "t1", "clips": []}],
            }
        ],
        "playgroundAssets": [
            {"id": "pg1", "type": "video", "url": "/media?path=/data/outputs/pg.mp4"}
        ],
    }

    put_response = client.put("/api/library", json=payload)
    assert put_response.status_code == 200
    assert put_response.json() == {"status": "ok"}

    get_response = client.get("/api/library")
    assert get_response.status_code == 200
    assert get_response.json() == payload


def test_put_persists_to_library_file(client, test_state):
    payload = {"projects": [{"id": "p", "name": "n"}], "playgroundAssets": []}
    client.put("/api/library", json=payload)

    library_file = test_state.config.library_file
    assert library_file.exists()
    on_disk = json.loads(library_file.read_text(encoding="utf-8"))
    assert on_disk == payload


def test_put_defaults_missing_fields_to_empty_lists(client):
    response = client.put("/api/library", json={})
    assert response.status_code == 200

    get_response = client.get("/api/library")
    assert get_response.json() == {"projects": [], "playgroundAssets": []}


def test_corrupt_library_file_returns_empty(client, test_state):
    test_state.config.library_file.write_text("{ not valid json", encoding="utf-8")
    response = client.get("/api/library")
    assert response.status_code == 200
    assert response.json() == {"projects": [], "playgroundAssets": []}
