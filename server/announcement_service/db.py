# -*- coding: utf-8 -*-
"""SQLite storage for announcements.

One table, one file.  Every write bumps ``updated_at``; changing the title or
the body also recomputes ``content_version``, which is what makes a tenant's
"got it" dismissal expire (see ``goal-and-requirements.md``).
"""

from __future__ import annotations

import hashlib
import sqlite3
import uuid
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator, Mapping, Optional

PUBLISHED = "published"
UNPUBLISHED = "unpublished"
STATUSES = (PUBLISHED, UNPUBLISHED)

SCHEMA = """
CREATE TABLE IF NOT EXISTS announcements (
    id              TEXT PRIMARY KEY,
    title           TEXT NOT NULL,
    body_md         TEXT NOT NULL DEFAULT '',
    published_at    TEXT NOT NULL,
    status          TEXT NOT NULL CHECK (status IN ('published', 'unpublished')),
    content_version TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_announcements_feed
    ON announcements (status, published_at DESC, id DESC);
"""


def utc_now() -> str:
    """Second-resolution UTC timestamp in the ISO shape JavaScript parses."""
    return (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def content_version(title: str, body_md: str) -> str:
    """Derive the version from the content itself.

    An operator editing either field produces a new version without having to
    bump anything by hand, which re-shows the announcement to everyone who had
    dismissed the old text.
    """
    digest = hashlib.sha256(f"{title}\n{body_md}".encode("utf-8")).hexdigest()
    return digest[:16]


@dataclass(frozen=True)
class Announcement:
    id: str
    title: str
    body_md: str
    published_at: str
    status: str
    content_version: str
    updated_at: str

    def as_public(self) -> dict[str, str]:
        """The subset a tenant may see."""
        return {
            "id": self.id,
            "title": self.title,
            "body_md": self.body_md,
            "published_at": self.published_at,
            "content_version": self.content_version,
        }

    def as_admin(self) -> dict[str, str]:
        return asdict(self)


class Store:
    """Announcement CRUD.  Safe to call from any thread (one connection each)."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def initialize(self) -> None:
        with self._connect() as connection:
            connection.executescript(SCHEMA)

    def list_all(self) -> list[Announcement]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM announcements"
                " ORDER BY published_at DESC, id DESC",
            ).fetchall()
        return [_row(row) for row in rows]

    def list_published(self) -> list[Announcement]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM announcements WHERE status = ?"
                " ORDER BY published_at DESC, id DESC",
                (PUBLISHED,),
            ).fetchall()
        return [_row(row) for row in rows]

    def get(self, announcement_id: str) -> Optional[Announcement]:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM announcements WHERE id = ?",
                (announcement_id,),
            ).fetchone()
        return _row(row) if row is not None else None

    def create(
        self,
        *,
        title: str,
        body_md: str = "",
        published_at: Optional[str] = None,
        status: str = PUBLISHED,
    ) -> Announcement:
        _check_status(status)
        now = utc_now()
        announcement = Announcement(
            id=uuid.uuid4().hex[:12],
            title=title,
            body_md=body_md,
            published_at=published_at or now,
            status=status,
            content_version=content_version(title, body_md),
            updated_at=now,
        )
        with self._connect() as connection:
            connection.execute(
                "INSERT INTO announcements (id, title, body_md, published_at,"
                " status, content_version, updated_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    announcement.id,
                    announcement.title,
                    announcement.body_md,
                    announcement.published_at,
                    announcement.status,
                    announcement.content_version,
                    announcement.updated_at,
                ),
            )
        return announcement

    def update(
        self,
        announcement_id: str,
        changes: Mapping[str, Any],
    ) -> Optional[Announcement]:
        current = self.get(announcement_id)
        if current is None:
            return None

        title = changes.get("title", current.title)
        body_md = changes.get("body_md", current.body_md)
        status = changes.get("status", current.status)
        published_at = changes.get("published_at", current.published_at)
        _check_status(status)

        version = current.content_version
        if title != current.title or body_md != current.body_md:
            version = content_version(title, body_md)

        updated = Announcement(
            id=current.id,
            title=title,
            body_md=body_md,
            published_at=published_at,
            status=status,
            content_version=version,
            updated_at=utc_now(),
        )
        with self._connect() as connection:
            connection.execute(
                "UPDATE announcements SET title = ?, body_md = ?,"
                " published_at = ?, status = ?, content_version = ?,"
                " updated_at = ? WHERE id = ?",
                (
                    updated.title,
                    updated.body_md,
                    updated.published_at,
                    updated.status,
                    updated.content_version,
                    updated.updated_at,
                    updated.id,
                ),
            )
        return updated

    def delete(self, announcement_id: str) -> bool:
        with self._connect() as connection:
            cursor = connection.execute(
                "DELETE FROM announcements WHERE id = ?",
                (announcement_id,),
            )
        return cursor.rowcount > 0


def _row(row: sqlite3.Row) -> Announcement:
    return Announcement(
        id=row["id"],
        title=row["title"],
        body_md=row["body_md"],
        published_at=row["published_at"],
        status=row["status"],
        content_version=row["content_version"],
        updated_at=row["updated_at"],
    )


def _check_status(status: str) -> None:
    if status not in STATUSES:
        raise ValueError(f"status must be one of {STATUSES}, got {status!r}")
