# -*- coding: utf-8 -*-
"""FastAPI application: admin CRUD, the tenant read-only feed, the admin page."""

from __future__ import annotations

import hashlib
import hmac
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, Optional

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .auth import AdminAuth
from .db import PUBLISHED, UNPUBLISHED, Announcement, Store

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

Status = Literal["published", "unpublished"]


@dataclass(frozen=True)
class Settings:
    """Everything the service needs, resolved once at start-up."""

    db_path: Path
    admin_password: str
    read_token: str = ""
    static_dir: Path = STATIC_DIR
    token_ttl_seconds: int = 12 * 60 * 60

    @classmethod
    def from_env(cls, environ: Optional[dict[str, str]] = None) -> "Settings":
        env = os.environ if environ is None else environ
        password = env.get("ANNOUNCEMENT_ADMIN_PASSWORD", "")
        if not password:
            raise RuntimeError("ANNOUNCEMENT_ADMIN_PASSWORD is not set")
        db_path = Path(env.get("ANNOUNCEMENT_DB", "./data/announcements.db"))
        return cls(
            db_path=db_path,
            admin_password=password,
            read_token=env.get("ANNOUNCEMENT_READ_TOKEN", ""),
            static_dir=Path(env.get("ANNOUNCEMENT_STATIC_DIR", STATIC_DIR)),
        )


class LoginBody(BaseModel):
    password: str = Field(min_length=1, max_length=256)


class AnnouncementBody(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    body_md: str = Field(default="", max_length=40_000)
    published_at: Optional[str] = Field(default=None, max_length=64)
    status: Status = PUBLISHED


class AnnouncementPatch(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    body_md: Optional[str] = Field(default=None, max_length=40_000)
    published_at: Optional[str] = Field(default=None, max_length=64)
    status: Optional[Status] = None


def _bearer(request: Request) -> str:
    header = request.headers.get("authorization", "")
    scheme, _, value = header.partition(" ")
    if scheme.lower() != "bearer":
        return ""
    return value.strip()


def feed_etag(items: list[Announcement]) -> str:
    """A change whenever any published item or its content version changes."""
    digest = hashlib.sha256()
    for item in items:
        digest.update(f"{item.id}:{item.content_version}:{item.published_at};".encode())
    return f'"{digest.hexdigest()[:32]}"'


def create_app(
    settings: Optional[Settings] = None,
    *,
    store: Optional[Store] = None,
) -> FastAPI:
    settings = settings or Settings.from_env()
    store = store or Store(settings.db_path)
    store.initialize()
    auth = AdminAuth(settings.admin_password, ttl_seconds=settings.token_ttl_seconds)

    app = FastAPI(title="QwenPaw Hub Announcements", version="1.0.0")
    app.state.settings = settings
    app.state.store = store
    app.state.auth = auth

    def require_admin(request: Request) -> None:
        if not auth.verify(_bearer(request)):
            raise HTTPException(status_code=401, detail="admin token required")

    @app.middleware("http")
    async def revalidate_admin_assets(request: Request, call_next):
        """Admin assets carry no version in their URL, so always revalidate.

        Without a Cache-Control header the browser applies heuristic freshness
        (10% of the file's age) and keeps serving the previous admin.css/js long
        after an upgrade changed them.
        """
        response = await call_next(request)
        if not request.url.path.startswith("/api/"):
            response.headers.setdefault("Cache-Control", "no-cache")
        return response

    @app.get("/api/health")
    def health() -> dict[str, bool]:
        return {"ok": True}

    @app.post("/api/admin/login")
    def login(body: LoginBody) -> dict[str, Any]:
        if not auth.check_password(body.password):
            raise HTTPException(status_code=401, detail="wrong password")
        token, expires_at = auth.issue()
        return {"token": token, "expires_at": expires_at}

    @app.get("/api/admin/announcements", dependencies=[Depends(require_admin)])
    def list_announcements() -> dict[str, Any]:
        return {"items": [item.as_admin() for item in store.list_all()]}

    @app.post(
        "/api/admin/announcements",
        status_code=201,
        dependencies=[Depends(require_admin)],
    )
    def create_announcement(body: AnnouncementBody) -> dict[str, Any]:
        created = store.create(
            title=body.title,
            body_md=body.body_md,
            published_at=body.published_at,
            status=body.status,
        )
        return created.as_admin()

    @app.patch(
        "/api/admin/announcements/{announcement_id}",
        dependencies=[Depends(require_admin)],
    )
    def patch_announcement(
        announcement_id: str,
        body: AnnouncementPatch,
    ) -> dict[str, Any]:
        changes = body.model_dump(exclude_unset=True)
        if not changes:
            raise HTTPException(status_code=422, detail="no fields to update")
        updated = store.update(announcement_id, changes)
        if updated is None:
            raise HTTPException(status_code=404, detail="announcement not found")
        return updated.as_admin()

    @app.delete(
        "/api/admin/announcements/{announcement_id}",
        status_code=204,
        dependencies=[Depends(require_admin)],
    )
    def delete_announcement(announcement_id: str) -> Response:
        if not store.delete(announcement_id):
            raise HTTPException(status_code=404, detail="announcement not found")
        return Response(status_code=204)

    @app.get("/api/public/announcements")
    def public_announcements(request: Request) -> Response:
        if settings.read_token:
            supplied = _bearer(request)
            if not hmac.compare_digest(supplied, settings.read_token):
                raise HTTPException(status_code=401, detail="read token required")

        items = store.list_published()
        etag = feed_etag(items)
        headers = {"ETag": etag, "Cache-Control": "no-cache"}
        if _matches_etag(request.headers.get("if-none-match"), etag):
            return Response(status_code=304, headers=headers)
        return JSONResponse(
            {"items": [item.as_public() for item in items]},
            headers=headers,
        )

    @app.get("/")
    def admin_page() -> FileResponse:
        page = settings.static_dir / "index.html"
        if not page.is_file():
            raise HTTPException(status_code=500, detail="admin page is missing")
        return FileResponse(page)

    if settings.static_dir.is_dir():
        app.mount(
            "/static",
            StaticFiles(directory=str(settings.static_dir)),
            name="static",
        )

    return app


def _matches_etag(header: Optional[str], etag: str) -> bool:
    """Weak-safe If-None-Match check; ``*`` never matches our single feed."""
    if not header:
        return False
    candidates = [part.strip() for part in header.split(",")]
    return any(_strip_weak(part) == etag for part in candidates)


def _strip_weak(value: str) -> str:
    return value[2:] if value.startswith("W/") else value
