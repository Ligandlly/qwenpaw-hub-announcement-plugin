# -*- coding: utf-8 -*-
"""The HTTP surface the host adapter exposes for our PawApp.

The host mounts every `PawApp` route under `/api/<app_id>`; this mirrors that
mounting so the URLs in the README and the console bundle are the tested ones.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi import FastAPI, Request
from starlette.responses import JSONResponse, Response

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import plugin as backend  # noqa: E402
from qwenpaw.plugins.apps import HttpRequest  # noqa: E402

API_PREFIX = f"/api/{backend.PLUGIN_ID}"


def mount_paw_app(app_routes) -> FastAPI:
    """Minimal copy of `qwenpaw.plugins._apps.register`'s dispatch."""
    api = FastAPI()
    for path, methods, handler in app_routes:

        async def endpoint(request: Request, _handler=handler) -> Response:
            public = HttpRequest(
                request.method,
                request.url.path,
                dict(request.path_params),
                dict(request.query_params),
                dict(request.headers),
                await request.body(),
            )
            result = await _handler(None, public)
            if isinstance(result.body, (bytes, str)):
                return Response(
                    result.body,
                    status_code=result.status,
                    headers=dict(result.headers),
                    media_type=result.media_type or "text/plain",
                )
            return JSONResponse(
                result.body,
                status_code=result.status,
                headers=dict(result.headers),
            )

        api.add_api_route(
            API_PREFIX + path,
            endpoint,
            methods=list(methods),
        )
    return api


class _FakeStorage:
    def __init__(self) -> None:
        self.data: dict[str, object] = {}

    async def aread_json(self, name: str, default=None):
        return self.data.get(name, default)

    async def awrite_json(self, name: str, value) -> None:
        self.data[name] = value


class _FakeLogger:
    def info(self, *args, **kwargs) -> None:  # pragma: no cover - noise
        pass

    def warning(self, *args, **kwargs) -> None:  # pragma: no cover - noise
        pass


@pytest.fixture()
def client():
    from fastapi.testclient import TestClient

    sync = backend.AnnouncementSync(
        backend.Config(),
        _FakeStorage(),
        _FakeLogger(),
    )
    sync.snapshot = backend.Snapshot(
        fetched_at="2026-11-02T14:05:00Z",
        items=[
            {
                "id": "a1",
                "title": "停机升级",
                "body_md": "今晚 **22:00**",
                "published_at": "2026-11-02T14:00:00Z",
                "content_version": "v1",
            },
        ],
    )
    backend._sync = sync
    try:
        with TestClient(mount_paw_app(backend.app._routes)) as test_client:
            yield test_client
    finally:
        backend._sync = None


def test_routes_are_mounted_under_the_app_prefix() -> None:
    paths = {path for path, _methods, _handler in backend.app._routes}
    assert paths == {"/announcements", "/announcements/dismiss"}


def test_get_announcements(client) -> None:
    response = client.get(f"{API_PREFIX}/announcements")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    body = response.json()
    assert body["fetched_at"] == "2026-11-02T14:05:00Z"
    assert body["stale"] is False
    assert [item["id"] for item in body["items"]] == ["a1"]


def test_post_dismiss(client) -> None:
    response = client.post(
        f"{API_PREFIX}/announcements/dismiss",
        json={"id": "a1", "content_version": "v1"},
    )
    assert response.status_code == 200
    assert response.json() == {"dismissed": {"a1": "v1"}}
    assert client.get(f"{API_PREFIX}/announcements").json()["items"] == []


def test_post_dismiss_unknown_id(client) -> None:
    response = client.post(
        f"{API_PREFIX}/announcements/dismiss",
        json={"id": "nope"},
    )
    assert response.status_code == 404
