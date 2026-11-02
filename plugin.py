# -*- coding: utf-8 -*-
"""QwenPaw Hub announcement plugin — backend entry point.

Polls the central announcement service and serves the cached result to the
console at ``GET /api/hub-announcement/announcements``.  The console never
talks to the central service itself: container egress is not reliable, and a
cache keeps the announcement card working while the service is unreachable.

Configuration lives in ``hub-announcement.config.json`` next to this file,
because the host exposes no plugin settings UI::

    {"service_url": "https://announce.example.com", "read_token": "", "poll_seconds": 60}

``HUB_ANNOUNCEMENT_SERVICE_URL`` / ``HUB_ANNOUNCEMENT_READ_TOKEN`` /
``HUB_ANNOUNCEMENT_POLL_SECONDS`` override it (useful for local testing).
With no ``service_url`` the plugin stays idle and serves an empty list.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx

from qwenpaw.plugins.apps import HttpRequest, HttpResponse, PawApp
from qwenpaw.plugins.sdk import PluginContext

PLUGIN_ID = "hub-announcement"
CONFIG_FILE = "hub-announcement.config.json"
CACHE_FILE = "announcements.json"
DISMISSED_FILE = "dismissed.json"
DEFAULT_POLL_SECONDS = 60.0
MIN_POLL_SECONDS = 5.0
REQUEST_TIMEOUT = 10.0
ITEMS_FEED = "/api/public/announcements"


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


@dataclass(frozen=True)
class Config:
    """Where the service lives and how often to ask it."""

    service_url: str = ""
    read_token: str = ""
    poll_seconds: float = DEFAULT_POLL_SECONDS

    @property
    def configured(self) -> bool:
        return bool(self.service_url.strip())

    @property
    def feed_url(self) -> str:
        return self.service_url.rstrip("/") + ITEMS_FEED

    def headers(self) -> dict[str, str]:
        headers = {"Accept": "application/json"}
        if self.read_token:
            headers["Authorization"] = f"Bearer {self.read_token}"
        return headers

    @classmethod
    def from_dict(cls, raw: Any) -> "Config":
        data = raw if isinstance(raw, dict) else {}
        try:
            poll = float(data.get("poll_seconds", DEFAULT_POLL_SECONDS))
        except (TypeError, ValueError):
            poll = DEFAULT_POLL_SECONDS
        return cls(
            service_url=str(data.get("service_url") or "").strip(),
            read_token=str(data.get("read_token") or "").strip(),
            poll_seconds=max(MIN_POLL_SECONDS, poll),
        )

    @classmethod
    def load(cls, plugin_dir: Path, environ: dict[str, str] | None = None) -> "Config":
        raw: Any = {}
        path = plugin_dir / CONFIG_FILE
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            raw = {}
        except (OSError, ValueError):
            raw = {}
        config = cls.from_dict(raw)
        env = os.environ if environ is None else environ
        service_url = env.get("HUB_ANNOUNCEMENT_SERVICE_URL")
        read_token = env.get("HUB_ANNOUNCEMENT_READ_TOKEN")
        poll = env.get("HUB_ANNOUNCEMENT_POLL_SECONDS")
        overrides: dict[str, Any] = {}
        if service_url is not None:
            overrides["service_url"] = service_url
        if read_token is not None:
            overrides["read_token"] = read_token
        if poll is not None:
            overrides["poll_seconds"] = poll
        if not overrides:
            return config
        merged = {
            "service_url": overrides.get("service_url", config.service_url),
            "read_token": overrides.get("read_token", config.read_token),
            "poll_seconds": overrides.get("poll_seconds", config.poll_seconds),
        }
        return cls.from_dict(merged)


def _clean_dismissed(raw: Any) -> dict[str, str]:
    if not isinstance(raw, dict):
        return {}
    return {
        str(key): str(value)
        for key, value in raw.items()
        if isinstance(key, str) and isinstance(value, str)
    }


def normalise_items(raw: Any) -> list[dict[str, str]]:
    """Keep only the fields the console renders, dropping malformed rows."""
    items: list[dict[str, str]] = []
    if not isinstance(raw, list):
        return items
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        announcement_id = str(entry.get("id") or "").strip()
        title = str(entry.get("title") or "").strip()
        if not announcement_id or not title:
            continue
        items.append(
            {
                "id": announcement_id,
                "title": title,
                "body_md": str(entry.get("body_md") or ""),
                "published_at": str(entry.get("published_at") or ""),
                "content_version": str(entry.get("content_version") or ""),
            },
        )
    return items


@dataclass
class Snapshot:
    """What the console is allowed to see, plus how fresh it is."""

    fetched_at: str | None = None
    items: list[dict[str, str]] = field(default_factory=list)
    etag: str | None = None
    stale: bool = False

    def payload(self) -> dict[str, Any]:
        return {
            "fetched_at": self.fetched_at,
            "items": list(self.items),
            "stale": self.stale,
        }

    def to_cache(self) -> dict[str, Any]:
        return {
            "fetched_at": self.fetched_at,
            "items": list(self.items),
            "etag": self.etag,
        }

    @classmethod
    def from_cache(cls, raw: Any) -> "Snapshot":
        data = raw if isinstance(raw, dict) else {}
        fetched_at = data.get("fetched_at")
        etag = data.get("etag")
        return cls(
            fetched_at=str(fetched_at) if fetched_at else None,
            items=normalise_items(data.get("items")),
            etag=str(etag) if etag else None,
        )


class AnnouncementSync:
    """Fetches the feed and owns the cached snapshot."""

    def __init__(
        self,
        config: Config,
        storage: Any,
        logger: Any,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.config = config
        self.storage = storage
        self.logger = logger
        self.snapshot = Snapshot()
        self.dismissed: dict[str, str] = {}
        self._client: httpx.AsyncClient | None = None
        self._transport = transport
        self._last_error: str | None = None
        self._lock = asyncio.Lock()

    async def load_cache(self) -> None:
        try:
            raw = await self.storage.aread_json(CACHE_FILE, None)
        except (OSError, ValueError):
            raw = None
        if raw is not None:
            self.snapshot = Snapshot.from_cache(raw)
        self.dismissed = _clean_dismissed(await self._read_dismissed())

    async def _read_dismissed(self) -> Any:
        try:
            return await self.storage.aread_json(DISMISSED_FILE, None)
        except (OSError, ValueError):
            return None

    def visible_items(self) -> list[dict[str, str]]:
        """Announcements the console may still show (not dismissed)."""
        return [
            item
            for item in self.snapshot.items
            if self.dismissed.get(item["id"]) != item["content_version"]
        ]

    async def dismiss(self, announcement_id: str, content_version: str) -> None:
        self.dismissed[announcement_id] = content_version
        try:
            await self.storage.awrite_json(DISMISSED_FILE, self.dismissed)
        except (OSError, ValueError) as exc:
            self.logger.warning(
                "could not persist dismissal",
                fields={"error": str(exc)},
            )
    async def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=REQUEST_TIMEOUT,
                transport=self._transport,
            )
        return self._client

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def refresh(self) -> None:
        """One poll iteration.  Never raises: a failed poll keeps the cache."""
        if not self.config.configured:
            return
        async with self._lock:
            headers = self.config.headers()
            if self.snapshot.etag:
                headers["If-None-Match"] = self.snapshot.etag
            try:
                client = await self._http()
                response = await client.get(self.config.feed_url, headers=headers)
                if response.status_code == 304:
                    self.snapshot.stale = False
                    self._note_success()
                    return
                response.raise_for_status()
                payload = response.json()
                items = normalise_items(payload.get("items") if isinstance(payload, dict) else payload)
                self.snapshot = Snapshot(
                    fetched_at=_now(),
                    items=items,
                    etag=response.headers.get("etag"),
                )
                self._prune_dismissed()
                await self._save()
                self._note_success()
            except (httpx.HTTPError, ValueError, OSError) as exc:
                self._note_failure(exc)

    def _note_success(self) -> None:
        if self._last_error is not None:
            self.logger.info("announcement feed recovered")
            self._last_error = None

    def _note_failure(self, exc: BaseException) -> None:
        self.snapshot.stale = True
        message = f"{type(exc).__name__}: {exc}"
        if message != self._last_error:
            self._last_error = message
            self.logger.warning(
                "announcement feed unreachable",
                fields={"service_url": self.config.service_url, "error": message},
            )

    def _prune_dismissed(self) -> None:
        """Forget dismissals for announcements that no longer exist."""
        live = {item["id"] for item in self.snapshot.items}
        kept = {key: value for key, value in self.dismissed.items() if key in live}
        if kept != self.dismissed:
            self.dismissed = kept

    async def _save(self) -> None:
        try:
            await self.storage.awrite_json(CACHE_FILE, self.snapshot.to_cache())
        except (OSError, ValueError) as exc:
            self.logger.warning(
                "could not cache announcements",
                fields={"error": str(exc)},
            )


app = PawApp("Announcements", app_id=PLUGIN_ID)
_sync: AnnouncementSync | None = None


@app.route("/announcements")
async def get_announcements(
    _ctx: Any,
    _request: HttpRequest,
) -> HttpResponse:
    """The cached feed the console renders.  Always a 200."""
    if _sync is None:
        return HttpResponse(Snapshot().payload(), headers={"Cache-Control": "no-store"})
    payload = _sync.snapshot.payload()
    payload["items"] = _sync.visible_items()
    return HttpResponse(payload, headers={"Cache-Control": "no-store"})


@app.route("/announcements/dismiss", methods=("POST",))
async def dismiss_announcement(
    _ctx: Any,
    request: HttpRequest,
) -> HttpResponse:
    """Remember that this tenant has read one version of an announcement."""
    if _sync is None:
        return HttpResponse({"detail": "announcement plugin is not active"}, status=503)
    try:
        payload = request.json()
    except ValueError:
        return HttpResponse({"detail": "invalid JSON body"}, status=400)
    if not isinstance(payload, dict):
        return HttpResponse({"detail": "invalid JSON body"}, status=400)
    announcement_id = str(payload.get("id") or "").strip()
    content_version = str(payload.get("content_version") or "").strip()
    known = {item["id"]: item["content_version"] for item in _sync.snapshot.items}
    if not announcement_id or announcement_id not in known:
        return HttpResponse({"detail": "unknown announcement"}, status=404)
    await _sync.dismiss(announcement_id, content_version or known[announcement_id])
    return HttpResponse({"dismissed": dict(_sync.dismissed)})


async def _poll_loop(sync: AnnouncementSync, interval: float) -> None:
    while True:
        await asyncio.sleep(interval)
        await sync.refresh()


class Plugin:
    """Wires the PawApp, the cache and the polling task."""

    def register(self, context: PluginContext) -> None:
        context.register_app(app)
        context.on_activate(self._activate)

    async def _activate(self, context: PluginContext) -> None:
        global _sync
        config = Config.load(Path(__file__).resolve().parent)
        sync = AnnouncementSync(config, context.storage, context.logger)
        _sync = sync
        context.resources.connection(sync, description="announcement client")
        await sync.load_cache()
        if not config.configured:
            context.logger.info(
                "announcement service not configured; serving cached only",
                fields={"config": CONFIG_FILE},
            )
            return
        await sync.refresh()
        context.resources.task(
            _poll_loop(sync, config.poll_seconds),
            description="announcement poll",
        )
        context.logger.info(
            "announcement polling started",
            fields={
                "service_url": config.service_url,
                "poll_seconds": config.poll_seconds,
            },
        )


plugin = Plugin()
