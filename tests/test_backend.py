# -*- coding: utf-8 -*-
"""Backend behaviour: config, cache, polling and the console-facing route."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import plugin as backend  # noqa: E402


class FakeStorage:
    """In-memory stand-in for PluginStorage."""

    def __init__(self, data: dict | None = None) -> None:
        self.data = dict(data or {})
        self.writes = 0

    async def aread_json(self, name, default=None):
        return self.data.get(name, default)

    async def awrite_json(self, name, value):
        self.data[name] = json.loads(json.dumps(value))
        self.writes += 1


class FakeLogger:
    def __init__(self) -> None:
        self.records: list[tuple[str, str, dict]] = []

    def _record(self, level, message, fields=None):
        self.records.append((level, message, fields or {}))

    def info(self, message, *, fields=None):
        self._record("info", message, fields)

    def warning(self, message, *, fields=None):
        self._record("warning", message, fields)

    def error(self, message, *, fields=None):
        self._record("error", message, fields)

    def levels(self) -> list[str]:
        return [level for level, _, _ in self.records]


def make_sync(tmp_path: Path, handler, **config) -> backend.AnnouncementSync:
    settings = backend.Config(**{"service_url": "https://ann.example", **config})
    return backend.AnnouncementSync(
        settings,
        FakeStorage(),
        FakeLogger(),
        transport=httpx.MockTransport(handler),
    )


FEED = {
    "items": [
        {
            "id": "a1",
            "title": "停机升级",
            "body_md": "今晚 22:00",
            "published_at": "2026-11-01T00:00:00Z",
            "content_version": "v1",
        },
        {"id": "", "title": "无 id 被丢弃"},
        "不是对象",
    ],
}


def test_config_defaults_and_file(tmp_path: Path) -> None:
    assert backend.Config.load(tmp_path) == backend.Config()
    (tmp_path / backend.CONFIG_FILE).write_text(
        json.dumps({"service_url": " https://ann.example/ ", "read_token": " t ", "poll_seconds": 5}),
        encoding="utf-8",
    )
    config = backend.Config.load(tmp_path)
    assert config.service_url == "https://ann.example/"
    assert config.feed_url == "https://ann.example/api/public/announcements"
    assert config.read_token == "t"
    assert config.headers()["Authorization"] == "Bearer t"


def test_config_clamps_and_survives_bad_json(tmp_path: Path) -> None:
    (tmp_path / backend.CONFIG_FILE).write_text("{not json", encoding="utf-8")
    assert backend.Config.load(tmp_path) == backend.Config()
    clamped = backend.Config.from_dict({"service_url": "x", "poll_seconds": 1})
    assert clamped.poll_seconds == backend.MIN_POLL_SECONDS
    assert backend.Config.from_dict({"poll_seconds": "abc"}).poll_seconds == 60.0


def test_env_overrides_file(tmp_path: Path) -> None:
    (tmp_path / backend.CONFIG_FILE).write_text(
        json.dumps({"service_url": "https://file.example"}),
        encoding="utf-8",
    )
    config = backend.Config.load(
        tmp_path,
        {"HUB_ANNOUNCEMENT_SERVICE_URL": "https://env.example", "HUB_ANNOUNCEMENT_POLL_SECONDS": "30"},
    )
    assert config.service_url == "https://env.example"
    assert config.poll_seconds == 30.0


def test_normalise_items_filters_junk() -> None:
    items = backend.normalise_items(FEED["items"])
    assert items == [
        {
            "id": "a1",
            "title": "停机升级",
            "body_md": "今晚 22:00",
            "published_at": "2026-11-01T00:00:00Z",
            "content_version": "v1",
        },
    ]
    assert backend.normalise_items(None) == []


async def test_refresh_stores_feed_and_cache() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=FEED, headers={"ETag": '"e1"'})

    sync = make_sync(Path(), handler)
    await sync.refresh()

    assert sync.snapshot.items[0]["id"] == "a1"
    assert sync.snapshot.etag == '"e1"'
    assert sync.snapshot.stale is False
    assert sync.snapshot.fetched_at
    assert seen[0].url.path == "/api/public/announcements"
    assert "If-None-Match" not in seen[0].headers
    assert sync.storage.data[backend.CACHE_FILE]["items"][0]["id"] == "a1"


async def test_refresh_sends_etag_and_handles_304() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(304, headers={"ETag": '"e1"'})

    sync = make_sync(Path(), handler)
    sync.snapshot = backend.Snapshot(fetched_at="2026-01-01T00:00:00Z", items=[{"id": "a1"}], etag='"e1"')
    await sync.refresh()

    assert seen[0].headers["If-None-Match"] == '"e1"'
    assert sync.snapshot.items == [{"id": "a1"}]
    assert sync.snapshot.fetched_at == "2026-01-01T00:00:00Z"
    assert sync.snapshot.stale is False


async def test_failed_poll_keeps_cache_and_logs_once() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, json={"detail": "down"})

    sync = make_sync(Path(), handler)
    sync.snapshot = backend.Snapshot(fetched_at="2026-01-01T00:00:00Z", items=[{"id": "a1"}])

    await sync.refresh()
    await sync.refresh()

    assert sync.snapshot.items == [{"id": "a1"}]
    assert sync.snapshot.stale is True
    assert sync.storage.writes == 0
    assert sync.logger.levels() == ["warning"]


async def test_transport_error_is_survived() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route", request=request)

    sync = make_sync(Path(), handler)
    await sync.refresh()

    assert sync.snapshot.items == []
    assert sync.snapshot.stale is True
    assert "ConnectError" in sync.logger.records[0][2]["error"]


async def test_unconfigured_service_never_calls_out() -> None:
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(200, json=FEED)

    sync = backend.AnnouncementSync(
        backend.Config(),
        FakeStorage(),
        FakeLogger(),
        transport=httpx.MockTransport(handler),
    )
    await sync.refresh()
    assert calls == []
    assert sync.snapshot.payload() == {"fetched_at": None, "items": [], "stale": False}


async def test_cache_round_trip() -> None:
    storage = FakeStorage(
        {
            backend.CACHE_FILE: {
                "fetched_at": "2026-01-01T00:00:00Z",
                "etag": '"e1"',
                "items": FEED["items"],
            },
        },
    )
    sync = backend.AnnouncementSync(backend.Config(), storage, FakeLogger())
    await sync.load_cache()
    assert sync.snapshot.fetched_at == "2026-01-01T00:00:00Z"
    assert sync.snapshot.etag == '"e1"'
    assert [item["id"] for item in sync.snapshot.items] == ["a1"]


async def test_route_serves_the_snapshot() -> None:
    backend._sync = backend.AnnouncementSync(
        backend.Config(),
        FakeStorage(),
        FakeLogger(),
    )
    backend._sync.snapshot = backend.Snapshot(
        fetched_at="2026-01-01T00:00:00Z",
        items=[{"id": "a1", "title": "t", "content_version": "v1"}],
    )
    try:
        response = await backend.get_announcements()
    finally:
        backend._sync = None
    assert response.status_code == 200
    body = json.loads(response.body)
    assert body["fetched_at"] == "2026-01-01T00:00:00Z"
    assert [item["id"] for item in body["items"]] == ["a1"]
    assert response.headers["cache-control"] == "no-store"


async def test_route_without_state_is_empty() -> None:
    backend._sync = None
    response = await backend.get_announcements()
    assert json.loads(response.body) == {
        "fetched_at": None,
        "items": [],
        "stale": False,
    }


def test_router_carries_both_routes() -> None:
    paths = {
        (route.path, tuple(sorted(route.methods)))
        for route in backend.router.routes
    }
    assert paths == {
        ("/announcements", ("GET",)),
        ("/announcements/dismiss", ("POST",)),
    }


class FakeApi:
    """Records what the plugin hands the host during ``register``."""

    def __init__(self) -> None:
        self.routers: list[tuple[object, str]] = []
        self.startup: list[tuple[str, object]] = []
        self.shutdown: list[tuple[str, object]] = []

    def register_http_router(self, router, *, prefix, tags=None) -> None:
        self.routers.append((router, prefix))

    def register_startup_hook(self, hook_name, callback, priority=100) -> None:
        self.startup.append((hook_name, callback))

    def register_shutdown_hook(self, hook_name, callback, priority=100) -> None:
        self.shutdown.append((hook_name, callback))


def test_register_mounts_the_router_and_the_poll_lifecycle() -> None:
    api = FakeApi()
    backend.Plugin().register(api)
    assert [prefix for _router, prefix in api.routers] == ["/hub-announcement"]
    assert api.routers[0][0] is backend.router
    assert len(api.startup) == 1 and len(api.shutdown) == 1
    start_hook, stop_hook = api.startup[0][1], api.shutdown[0][1]
    assert start_hook.__self__ is stop_hook.__self__


async def test_startup_and_shutdown_own_the_poll_task(tmp_path, monkeypatch) -> None:
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(200, json=FEED)

    sync = backend.AnnouncementSync(
        backend.Config(service_url="https://ann.example", poll_seconds=60.0),
        FakeStorage(),
        FakeLogger(),
        transport=httpx.MockTransport(handler),
    )
    monkeypatch.setattr(backend, "DATA_DIR", tmp_path / "data")
    monkeypatch.setattr(
        backend.Config,
        "load",
        classmethod(lambda cls, _dir, environ=None: sync.config),
    )
    monkeypatch.setattr(
        backend,
        "AnnouncementSync",
        lambda *args, **kwargs: sync,
    )

    instance = backend.Plugin()
    await instance._start()  # noqa: SLF001 - the lifecycle is the unit
    try:
        assert backend._sync is sync
        assert backend._poller is not None and not backend._poller.done()
        assert len(calls) == 1
    finally:
        await instance._stop()  # noqa: SLF001 - the lifecycle is the unit
    assert backend._sync is None
    assert backend._poller is None


# --- dismissals -------------------------------------------------------------

class FakeRequest:
    """Just enough of a Starlette ``Request`` for the dismiss route."""

    def __init__(self, payload) -> None:
        if isinstance(payload, Exception):
            self._body = b"{not json"
        elif isinstance(payload, (bytes, bytearray)):
            self._body = bytes(payload)
        else:
            self._body = json.dumps(payload).encode("utf-8")

    async def body(self) -> bytes:
        return self._body


def install_sync(items=None) -> backend.AnnouncementSync:
    sync = backend.AnnouncementSync(backend.Config(), FakeStorage(), FakeLogger())
    sync.snapshot = backend.Snapshot(
        fetched_at="2026-01-01T00:00:00Z",
        items=list(items or [{"id": "a1", "title": "t", "content_version": "v1"}]),
    )
    backend._sync = sync
    return sync


async def test_dismiss_hides_the_item_and_persists() -> None:
    sync = install_sync()
    try:
        response = await backend.dismiss_announcement(
            FakeRequest({"id": "a1", "content_version": "v1"}),
        )
        feed = await backend.get_announcements()
    finally:
        backend._sync = None

    assert response.status_code == 200
    assert json.loads(response.body) == {"dismissed": {"a1": "v1"}}
    assert json.loads(feed.body)["items"] == []
    assert sync.storage.data[backend.DISMISSED_FILE] == {"a1": "v1"}


async def test_new_content_version_resurfaces_the_announcement() -> None:
    sync = install_sync()
    try:
        await backend.dismiss_announcement(
            FakeRequest({"id": "a1", "content_version": "v1"}),
        )
        # The announcement is edited centrally: same id, new version.
        sync.snapshot.items[0]["content_version"] = "v2"
        feed = await backend.get_announcements()
    finally:
        backend._sync = None

    assert [item["id"] for item in json.loads(feed.body)["items"]] == ["a1"]


async def test_dismiss_validation() -> None:
    sync = install_sync()
    try:
        unknown = await backend.dismiss_announcement(FakeRequest({"id": "zz"}))
        broken = await backend.dismiss_announcement(FakeRequest(ValueError("bad")))
        wrong_type = await backend.dismiss_announcement(FakeRequest(["a1"]))
    finally:
        backend._sync = None

    assert (unknown.status_code, json.loads(unknown.body)["detail"]) == (
        404,
        "unknown announcement",
    )
    assert (broken.status_code, json.loads(broken.body)["detail"]) == (
        400,
        "invalid JSON body",
    )
    assert wrong_type.status_code == 400
    assert sync.dismissed == {}


async def test_dismiss_without_active_plugin_is_503() -> None:
    backend._sync = None
    response = await backend.dismiss_announcement(FakeRequest({"id": "a1"}))
    assert response.status_code == 503


async def test_dismissal_survives_a_reload_and_is_cleaned() -> None:
    storage = FakeStorage(
        {
            backend.DISMISSED_FILE: {"a1": "v1", "gone": "v9", 3: 4},
            backend.CACHE_FILE: {"fetched_at": "x", "items": FEED["items"]},
        },
    )
    sync = backend.AnnouncementSync(backend.Config(), storage, FakeLogger())
    await sync.load_cache()

    assert sync.dismissed == {"a1": "v1", "gone": "v9"}

    sync._prune_dismissed()  # noqa: SLF001 - pruning is the unit under test
    assert sync.dismissed == {"a1": "v1"}
    assert sync.visible_items() == []


def test_json_file_storage_round_trip_and_traversal_guard(tmp_path) -> None:
    storage = backend.JsonFileStorage(tmp_path / "data")
    storage.write_json(backend.CACHE_FILE, {"items": [{"id": "a1"}]})
    assert storage.read_json(backend.CACHE_FILE) == {"items": [{"id": "a1"}]}
    assert storage.read_json("missing.json", "fallback") == "fallback"
    with pytest.raises(ValueError):
        storage.read_json("../escape.json")
    assert (tmp_path / "data" / backend.CACHE_FILE).is_file()
