# -*- coding: utf-8 -*-
"""Store-level behaviour: versions, ordering, status filtering."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from announcement_service.db import Store, content_version  # noqa: E402


@pytest.fixture()
def store(tmp_path: Path) -> Store:
    instance = Store(tmp_path / "db.sqlite")
    instance.initialize()
    return instance


def test_content_version_tracks_title_and_body_only() -> None:
    assert content_version("标题", "正文") == content_version("标题", "正文")
    assert content_version("标题", "正文") != content_version("标题", "正文2")
    assert content_version("标题", "正文") != content_version("标题2", "正文")


def test_create_defaults_to_published_now(store: Store) -> None:
    created = store.create(title="停机升级", body_md="今晚 22:00")
    assert created.status == "published"
    assert created.published_at.endswith("Z")
    assert created.updated_at == created.published_at
    assert created.content_version == content_version("停机升级", "今晚 22:00")


def test_only_editing_content_changes_the_version(store: Store) -> None:
    created = store.create(title="A", body_md="B")

    same = store.update(created.id, {"status": "unpublished"})
    assert same is not None
    assert same.content_version == created.content_version
    assert same.updated_at >= created.updated_at

    edited = store.update(created.id, {"body_md": "B2"})
    assert edited is not None
    assert edited.content_version != created.content_version


def test_public_feed_excludes_unpublished_and_sorts_newest_first(store: Store) -> None:
    first = store.create(title="早", body_md="", published_at="2026-01-01T00:00:00Z")
    second = store.create(title="晚", body_md="", published_at="2026-02-01T00:00:00Z")
    hidden = store.create(title="草稿", body_md="", status="unpublished")

    published = [item.id for item in store.list_published()]
    assert published == [second.id, first.id]
    assert hidden.id not in published
    assert len(store.list_all()) == 3


def test_update_missing_and_delete(store: Store) -> None:
    assert store.update("nope", {"title": "x"}) is None
    created = store.create(title="A")
    assert store.delete(created.id) is True
    assert store.delete(created.id) is False


def test_rejects_unknown_status(store: Store) -> None:
    with pytest.raises(ValueError):
        store.create(title="A", status="draft")
