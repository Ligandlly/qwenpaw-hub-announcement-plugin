//! HTTP contract: admin auth, CRUD, the tenant feed and its ETag.

mod common;

use axum::http::{Method, StatusCode};
use common::{harness, login, send, static_dir, PASSWORD};
use serde_json::json;

async fn create(app: &axum::Router, auth: &str, fields: serde_json::Value) -> serde_json::Value {
    let mut payload = json!({ "title": "公告", "body_md": "正文" });
    payload
        .as_object_mut()
        .unwrap()
        .extend(fields.as_object().unwrap().clone());
    let reply = send(
        app,
        Method::POST,
        "/api/admin/announcements",
        &[("authorization", auth)],
        Some(payload),
    )
    .await;
    assert_eq!(
        reply.status,
        StatusCode::CREATED,
        "{}",
        String::from_utf8_lossy(&reply.body)
    );
    reply.json()
}

#[tokio::test]
async fn login_rejects_wrong_password() {
    let h = harness("");
    let reply = send(
        &h.app,
        Method::POST,
        "/api/admin/login",
        &[],
        Some(json!({ "password": "nope" })),
    )
    .await;
    assert_eq!(reply.status, StatusCode::UNAUTHORIZED);
    assert_eq!(reply.json()["detail"], "wrong password");
}

#[tokio::test]
async fn login_issues_a_token_with_expiry() {
    let h = harness("");
    let reply = send(
        &h.app,
        Method::POST,
        "/api/admin/login",
        &[],
        Some(json!({ "password": PASSWORD })),
    )
    .await;
    assert_eq!(reply.status, StatusCode::OK);
    let body = reply.json();
    assert!(body["token"].as_str().unwrap().contains('.'));
    assert!(body["expires_at"].as_i64().unwrap() > 0);
}

#[tokio::test]
async fn admin_routes_require_a_token() {
    let h = harness("");
    let forged = [("authorization", "Bearer abc.def")];
    assert_eq!(
        send(&h.app, Method::GET, "/api/admin/announcements", &[], None)
            .await
            .status,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        send(
            &h.app,
            Method::POST,
            "/api/admin/announcements",
            &[],
            Some(json!({ "title": "x" }))
        )
        .await
        .status,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        send(
            &h.app,
            Method::GET,
            "/api/admin/announcements",
            &forged,
            None
        )
        .await
        .status,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn crud_round_trip() {
    let h = harness("");
    let auth = login(&h.app).await;
    let created = create(
        &h.app,
        &auth,
        json!({ "title": "停机升级", "body_md": "**今晚 22:00**" }),
    )
    .await;
    assert_eq!(created["status"], "published");
    assert!(!created["content_version"].as_str().unwrap().is_empty());
    let id = created["id"].as_str().unwrap().to_string();

    let listed = send(
        &h.app,
        Method::GET,
        "/api/admin/announcements",
        &[("authorization", &auth)],
        None,
    )
    .await;
    let items = listed.json()["items"].as_array().unwrap().clone();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["id"], id.as_str());

    let uri = format!("/api/admin/announcements/{id}");
    let patched = send(
        &h.app,
        Method::PATCH,
        &uri,
        &[("authorization", &auth)],
        Some(json!({ "status": "unpublished" })),
    )
    .await;
    assert_eq!(patched.status, StatusCode::OK);
    assert_eq!(patched.json()["status"], "unpublished");
    assert_eq!(
        patched.json()["content_version"],
        created["content_version"]
    );

    assert_eq!(
        send(
            &h.app,
            Method::DELETE,
            &uri,
            &[("authorization", &auth)],
            None
        )
        .await
        .status,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        send(
            &h.app,
            Method::PATCH,
            &uri,
            &[("authorization", &auth)],
            Some(json!({ "title": "x" }))
        )
        .await
        .status,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn validation_and_empty_patch() {
    let h = harness("");
    let auth = login(&h.app).await;
    let auth_header = [("authorization", auth.as_str())];

    let empty_title = send(
        &h.app,
        Method::POST,
        "/api/admin/announcements",
        &auth_header,
        Some(json!({ "title": "" })),
    )
    .await;
    assert_eq!(empty_title.status, StatusCode::UNPROCESSABLE_ENTITY);

    let bad_status = send(
        &h.app,
        Method::POST,
        "/api/admin/announcements",
        &auth_header,
        Some(json!({ "title": "x", "status": "draft" })),
    )
    .await;
    assert_eq!(bad_status.status, StatusCode::UNPROCESSABLE_ENTITY);

    let created = create(&h.app, &auth, json!({})).await;
    let uri = format!(
        "/api/admin/announcements/{}",
        created["id"].as_str().unwrap()
    );
    let empty_patch = send(&h.app, Method::PATCH, &uri, &auth_header, Some(json!({}))).await;
    assert_eq!(empty_patch.status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(empty_patch.json()["detail"], "no fields to update");

    let null_title = send(
        &h.app,
        Method::PATCH,
        &uri,
        &auth_header,
        Some(json!({ "title": null })),
    )
    .await;
    assert_eq!(null_title.status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn length_limits_count_characters_not_bytes() {
    let h = harness("");
    let auth = login(&h.app).await;
    let auth_header = [("authorization", auth.as_str())];

    // 200 Chinese characters are 600 bytes: allowed. 201 characters: rejected.
    let at_limit = "标".repeat(200);
    let over_limit = "标".repeat(201);
    let ok = send(
        &h.app,
        Method::POST,
        "/api/admin/announcements",
        &auth_header,
        Some(json!({ "title": at_limit })),
    )
    .await;
    assert_eq!(ok.status, StatusCode::CREATED);
    let too_long = send(
        &h.app,
        Method::POST,
        "/api/admin/announcements",
        &auth_header,
        Some(json!({ "title": over_limit })),
    )
    .await;
    assert_eq!(too_long.status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn public_feed_only_returns_published() {
    let h = harness("");
    let auth = login(&h.app).await;
    let shown = create(&h.app, &auth, json!({ "title": "可见" })).await;
    create(
        &h.app,
        &auth,
        json!({ "title": "隐藏", "status": "unpublished" }),
    )
    .await;

    let feed = send(&h.app, Method::GET, "/api/public/announcements", &[], None).await;
    assert_eq!(feed.status, StatusCode::OK);
    let items = feed.json()["items"].as_array().unwrap().clone();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["title"], "可见");
    let mut keys: Vec<&str> = items[0]
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        ["body_md", "content_version", "id", "published_at", "title"]
    );
    assert_eq!(items[0]["id"], shown["id"]);
}

#[tokio::test]
async fn feed_etag_is_stable_and_conditional() {
    let h = harness("");
    let auth = login(&h.app).await;
    let created = create(&h.app, &auth, json!({ "title": "A" })).await;

    let first = send(&h.app, Method::GET, "/api/public/announcements", &[], None).await;
    let etag = first.header("etag");
    assert!(etag.starts_with('"') && etag.ends_with('"'));
    assert_eq!(first.header("cache-control"), "no-cache");

    let unchanged = send(&h.app, Method::GET, "/api/public/announcements", &[], None).await;
    assert_eq!(unchanged.header("etag"), etag);

    let cached = send(
        &h.app,
        Method::GET,
        "/api/public/announcements",
        &[("if-none-match", &etag)],
        None,
    )
    .await;
    assert_eq!(cached.status, StatusCode::NOT_MODIFIED);
    assert!(cached.body.is_empty());

    let weak = format!("W/{etag}");
    let weak_cached = send(
        &h.app,
        Method::GET,
        "/api/public/announcements",
        &[("if-none-match", &weak)],
        None,
    )
    .await;
    assert_eq!(weak_cached.status, StatusCode::NOT_MODIFIED);

    let uri = format!(
        "/api/admin/announcements/{}",
        created["id"].as_str().unwrap()
    );
    send(
        &h.app,
        Method::PATCH,
        &uri,
        &[("authorization", &auth)],
        Some(json!({ "body_md": "改了" })),
    )
    .await;
    let changed = send(
        &h.app,
        Method::GET,
        "/api/public/announcements",
        &[("if-none-match", &etag)],
        None,
    )
    .await;
    assert_eq!(changed.status, StatusCode::OK);
    assert_ne!(changed.header("etag"), etag);
}

#[tokio::test]
async fn star_if_none_match_never_matches() {
    let h = harness("");
    let auth = login(&h.app).await;
    create(&h.app, &auth, json!({ "title": "A" })).await;
    let reply = send(
        &h.app,
        Method::GET,
        "/api/public/announcements",
        &[("if-none-match", "*")],
        None,
    )
    .await;
    assert_eq!(reply.status, StatusCode::OK);
}

#[tokio::test]
async fn unpublishing_changes_the_etag() {
    let h = harness("");
    let auth = login(&h.app).await;
    let created = create(&h.app, &auth, json!({ "title": "A" })).await;
    let etag = send(&h.app, Method::GET, "/api/public/announcements", &[], None)
        .await
        .header("etag");

    let uri = format!(
        "/api/admin/announcements/{}",
        created["id"].as_str().unwrap()
    );
    send(
        &h.app,
        Method::PATCH,
        &uri,
        &[("authorization", &auth)],
        Some(json!({ "status": "unpublished" })),
    )
    .await;
    let feed = send(
        &h.app,
        Method::GET,
        "/api/public/announcements",
        &[("if-none-match", &etag)],
        None,
    )
    .await;
    assert_eq!(feed.status, StatusCode::OK);
    assert_eq!(feed.json()["items"], json!([]));
}

#[tokio::test]
async fn read_token_is_enforced_when_configured() {
    let h = harness("tenant-token");
    let feed = "/api/public/announcements";
    assert_eq!(
        send(&h.app, Method::GET, feed, &[], None).await.status,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        send(
            &h.app,
            Method::GET,
            feed,
            &[("authorization", "Bearer wrong")],
            None
        )
        .await
        .status,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        send(
            &h.app,
            Method::GET,
            feed,
            &[("authorization", "Bearer tenant-token")],
            None
        )
        .await
        .status,
        StatusCode::OK
    );
}

#[tokio::test]
async fn admin_page_and_assets_are_served() {
    let h = harness("");
    let page = send(&h.app, Method::GET, "/", &[], None).await;
    assert_eq!(page.status, StatusCode::OK);
    assert!(String::from_utf8_lossy(&page.body).contains("公告后台"));
    assert_eq!(
        send(&h.app, Method::GET, "/static/admin.js", &[], None)
            .await
            .status,
        StatusCode::OK
    );
    assert_eq!(
        send(&h.app, Method::GET, "/static/admin.css", &[], None)
            .await
            .status,
        StatusCode::OK
    );
}

#[tokio::test]
async fn admin_assets_are_never_served_from_a_stale_cache() {
    let h = harness("");
    for path in ["/", "/static/admin.css", "/static/admin.js"] {
        let reply = send(&h.app, Method::GET, path, &[], None).await;
        assert_eq!(reply.header("cache-control"), "no-cache", "{path}");
    }
}

#[tokio::test]
async fn admin_css_keeps_hidden_elements_hidden() {
    let css = std::fs::read_to_string(static_dir().join("admin.css")).unwrap();
    assert!(css.contains("[hidden]"));
    assert!(css.contains("display: none !important"));
}

#[tokio::test]
async fn unknown_routes_return_a_json_404() {
    let h = harness("");
    let reply = send(&h.app, Method::GET, "/nope", &[], None).await;
    assert_eq!(reply.status, StatusCode::NOT_FOUND);
    assert_eq!(reply.json(), json!({ "detail": "Not Found" }));
    assert_eq!(reply.header("cache-control"), "no-cache");
}

#[tokio::test]
async fn health_reports_ok() {
    let h = harness("");
    let reply = send(&h.app, Method::GET, "/api/health", &[], None).await;
    assert_eq!(reply.json(), json!({ "ok": true }));
}
