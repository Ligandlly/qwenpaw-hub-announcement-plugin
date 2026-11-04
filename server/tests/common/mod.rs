//! Shared harness: an in-process router on a throwaway SQLite file.

#![allow(dead_code)]

use std::path::PathBuf;

use announcement_service::{create_app, Settings};
use axum::body::Body;
use axum::http::{HeaderMap, Method, Request, StatusCode};
use axum::Router;
use http_body_util::BodyExt;
use serde_json::Value;
use tempfile::TempDir;
use tower::ServiceExt;

pub const PASSWORD: &str = "s3cret";

pub struct Harness {
    pub app: Router,
    pub dir: TempDir,
}

pub struct Reply {
    pub status: StatusCode,
    pub headers: HeaderMap,
    pub body: Vec<u8>,
}

impl Reply {
    pub fn json(&self) -> Value {
        serde_json::from_slice(&self.body).expect("response body is JSON")
    }

    pub fn header(&self, name: &str) -> String {
        self.headers
            .get(name)
            .unwrap_or_else(|| panic!("missing header {name}"))
            .to_str()
            .unwrap()
            .to_string()
    }
}

pub fn static_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("static")
}

pub fn harness(read_token: &str) -> Harness {
    let dir = tempfile::tempdir().expect("tempdir");
    let mut settings = Settings::new(dir.path().join("announcements.db"), PASSWORD);
    settings.read_token = read_token.to_string();
    settings.static_dir = static_dir();
    let app = create_app(&settings).expect("app builds");
    Harness { app, dir }
}

/// Send one request through the router in-process.
pub async fn send(
    app: &Router,
    method: Method,
    uri: &str,
    headers: &[(&str, &str)],
    json: Option<Value>,
) -> Reply {
    let mut builder = Request::builder().method(method).uri(uri);
    for (name, value) in headers {
        builder = builder.header(*name, *value);
    }
    let body = match json {
        Some(value) => {
            builder = builder.header("content-type", "application/json");
            Body::from(value.to_string())
        }
        None => Body::empty(),
    };
    let response = app
        .clone()
        .oneshot(builder.body(body).unwrap())
        .await
        .expect("router is infallible");
    let status = response.status();
    let headers = response.headers().clone();
    let body = response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes()
        .to_vec();
    Reply {
        status,
        headers,
        body,
    }
}

pub async fn login(app: &Router) -> String {
    let reply = send(
        app,
        Method::POST,
        "/api/admin/login",
        &[],
        Some(serde_json::json!({ "password": PASSWORD })),
    )
    .await;
    assert_eq!(reply.status, StatusCode::OK);
    format!("Bearer {}", reply.json()["token"].as_str().unwrap())
}
