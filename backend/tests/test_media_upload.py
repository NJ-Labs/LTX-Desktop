from pathlib import Path

from fastapi.testclient import TestClient

from app_factory import create_app


def test_upload_media_is_saved_and_served(test_state, tmp_path: Path) -> None:
    media_root = tmp_path / "ltx-data"
    app = create_app(
        handler=test_state,
        media_roots=[media_root],
        media_upload_root=media_root,
    )

    with TestClient(app) as client:
        response = client.post(
            "/api/media/upload",
            data={"folder": "playground"},
            files={"file": ("preview.png", b"image-bytes", "image/png")},
        )
        assert response.status_code == 200
        payload = response.json()
        uploaded_path = Path(payload["path"])
        assert uploaded_path.parent == media_root / "playground"
        assert uploaded_path.read_bytes() == b"image-bytes"

        served = client.get(payload["url"])
        assert served.status_code == 200
        assert served.content == b"image-bytes"


def test_upload_media_rejects_unsafe_folder(test_state, tmp_path: Path) -> None:
    media_root = tmp_path / "ltx-data"
    app = create_app(handler=test_state, media_roots=[media_root], media_upload_root=media_root)

    with TestClient(app) as client:
        response = client.post(
            "/api/media/upload",
            data={"folder": "../escape"},
            files={"file": ("preview.png", b"image-bytes", "image/png")},
        )
        assert response.status_code == 400
