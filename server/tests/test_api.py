# -*- coding: utf-8 -*-
"""HTTP contract: admin auth, CRUD, the tenant feed and its ETag."""

from __future__ import annotations

from pathlib import Path

from announcement_service.app import Settings, create_app


def _create(client, admin, **fields):
    payload = {"title": "公告", "body_md": "正文", **fields}
    response = client.post("/api/admin/announcements", json=payload, headers=admin)
    assert response.status_code == 201, response.text
    return response.json()


def test_login_rejects_wrong_password(client) -> None:
    response = client.post("/api/admin/login", json={"password": "nope"})
    assert response.status_code == 401


def test_admin_routes_require_a_token(client) -> None:
    assert client.get("/api/admin/announcements").status_code == 401
    assert client.post("/api/admin/announcements", json={"title": "x"}).status_code == 401
    forged = {"Authorization": "Bearer abc.def"}
    assert client.get("/api/admin/announcements", headers=forged).status_code == 401


def test_crud_round_trip(client, admin) -> None:
    created = _create(client, admin, title="停机升级", body_md="**今晚 22:00**")
    assert created["status"] == "published"
    assert created["content_version"]

    listed = client.get("/api/admin/announcements", headers=admin).json()["items"]
    assert [item["id"] for item in listed] == [created["id"]]

    patched = client.patch(
        f"/api/admin/announcements/{created['id']}",
        json={"status": "unpublished"},
        headers=admin,
    )
    assert patched.status_code == 200
    assert patched.json()["status"] == "unpublished"
    assert patched.json()["content_version"] == created["content_version"]

    assert client.delete(
        f"/api/admin/announcements/{created['id']}",
        headers=admin,
    ).status_code == 204
    assert client.patch(
        f"/api/admin/announcements/{created['id']}",
        json={"title": "x"},
        headers=admin,
    ).status_code == 404


def test_validation_and_empty_patch(client, admin) -> None:
    assert client.post(
        "/api/admin/announcements",
        json={"title": ""},
        headers=admin,
    ).status_code == 422

    created = _create(client, admin)
    assert client.patch(
        f"/api/admin/announcements/{created['id']}",
        json={},
        headers=admin,
    ).status_code == 422


def test_public_feed_only_returns_published(client, admin) -> None:
    shown = _create(client, admin, title="可见")
    _create(client, admin, title="隐藏", status="unpublished")

    feed = client.get("/api/public/announcements")
    assert feed.status_code == 200
    items = feed.json()["items"]
    assert [item["title"] for item in items] == ["可见"]
    assert set(items[0]) == {"id", "title", "body_md", "published_at", "content_version"}
    assert items[0]["id"] == shown["id"]


def test_feed_etag_is_stable_and_conditional(client, admin) -> None:
    created = _create(client, admin, title="A")
    first = client.get("/api/public/announcements")
    etag = first.headers["etag"]
    assert etag

    unchanged = client.get("/api/public/announcements")
    assert unchanged.headers["etag"] == etag

    cached = client.get("/api/public/announcements", headers={"If-None-Match": etag})
    assert cached.status_code == 304
    assert cached.content == b""

    client.patch(
        f"/api/admin/announcements/{created['id']}",
        json={"body_md": "改了"},
        headers=admin,
    )
    changed = client.get("/api/public/announcements", headers={"If-None-Match": etag})
    assert changed.status_code == 200
    assert changed.headers["etag"] != etag


def test_unpublishing_changes_the_etag(client, admin) -> None:
    created = _create(client, admin, title="A")
    etag = client.get("/api/public/announcements").headers["etag"]

    client.patch(
        f"/api/admin/announcements/{created['id']}",
        json={"status": "unpublished"},
        headers=admin,
    )
    feed = client.get("/api/public/announcements", headers={"If-None-Match": etag})
    assert feed.status_code == 200
    assert feed.json()["items"] == []


def test_read_token_is_enforced_when_configured(settings: Settings) -> None:
    from fastapi.testclient import TestClient

    secured = create_app(
        Settings(
            db_path=settings.db_path,
            admin_password="s3cret",
            read_token="tenant-token",
            static_dir=settings.static_dir,
        ),
    )
    with TestClient(secured) as client:
        assert client.get("/api/public/announcements").status_code == 401
        assert client.get(
            "/api/public/announcements",
            headers={"Authorization": "Bearer wrong"},
        ).status_code == 401
        allowed = client.get(
            "/api/public/announcements",
            headers={"Authorization": "Bearer tenant-token"},
        )
        assert allowed.status_code == 200


def test_admin_page_and_assets_are_served(client) -> None:
    page = client.get("/")
    assert page.status_code == 200
    assert "公告后台" in page.text
    assert client.get("/static/admin.js").status_code == 200
    assert client.get("/static/admin.css").status_code == 200


def test_admin_css_keeps_hidden_elements_hidden(client) -> None:
    """Author `display` rules beat the UA `[hidden]` rule, so admin.css needs a guard.

    Without it the editor overlay (`.overlay { display: flex }`) is painted on top
    of the login card as soon as the backend page is opened.
    """
    css = (Path(__file__).resolve().parents[1] / "static" / "admin.css").read_text(
        encoding="utf-8"
    )
    assert "[hidden]" in css
    assert "display: none !important" in css
