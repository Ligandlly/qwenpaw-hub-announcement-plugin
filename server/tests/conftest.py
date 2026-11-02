# -*- coding: utf-8 -*-
"""Shared fixtures: a service on a throwaway SQLite file."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from announcement_service.app import Settings, create_app  # noqa: E402


@pytest.fixture()
def settings(tmp_path: Path) -> Settings:
    return Settings(
        db_path=tmp_path / "announcements.db",
        admin_password="s3cret",
        read_token="",
        static_dir=Path(__file__).resolve().parents[1] / "static",
    )


@pytest.fixture()
def app(settings: Settings):
    return create_app(settings)


@pytest.fixture()
def client(app):
    from fastapi.testclient import TestClient

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture()
def admin(client):
    """Auth header for the configured admin password."""
    response = client.post("/api/admin/login", json={"password": "s3cret"})
    assert response.status_code == 200
    token = response.json()["token"]
    return {"Authorization": f"Bearer {token}"}
