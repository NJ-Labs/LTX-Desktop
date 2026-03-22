"""Tests for offline safeguards in the Hugging Face downloader wrapper."""

from __future__ import annotations

import pytest

from services.model_downloader.hugging_face_downloader import HuggingFaceDownloader


def test_download_file_fails_in_offline_mode(monkeypatch):
    monkeypatch.setenv("LTX_OFFLINE", "1")

    downloader = HuggingFaceDownloader()

    with pytest.raises(RuntimeError, match="offline mode"):
        downloader.download_file("repo/id", "weights.safetensors", "/tmp/models")


def test_download_snapshot_fails_in_offline_mode(monkeypatch):
    monkeypatch.setenv("HF_HUB_OFFLINE", "1")

    downloader = HuggingFaceDownloader()

    with pytest.raises(RuntimeError, match="offline mode"):
        downloader.download_snapshot("repo/id", "/tmp/models")