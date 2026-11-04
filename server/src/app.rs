//! HTTP surface: admin CRUD, the tenant read-only feed, and the admin page.

use std::path::PathBuf;
use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, Path, Request, State};
use axum::http::header::{AUTHORIZATION, CACHE_CONTROL, ETAG, IF_NONE_MATCH};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::middleware::{from_fn, Next};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use tower_http::services::ServeDir;
use tower_http::trace::TraceLayer;

use crate::auth::AdminAuth;
use crate::config::Settings;
use crate::db::{
    hex_prefix, Announcement, AnnouncementChanges, NewAnnouncement, PublicAnnouncement, Store,
    StoreError, PUBLISHED, STATUSES,
};

const MAX_TITLE_CHARS: usize = 200;
const MAX_BODY_CHARS: usize = 40_000;
const MAX_PUBLISHED_AT_CHARS: usize = 64;
const MAX_PASSWORD_CHARS: usize = 256;
/// Room for a maximal body in 4-byte UTF-8 plus JSON escaping.
const MAX_REQUEST_BYTES: usize = 512 * 1024;

struct Inner {
    store: Store,
    auth: AdminAuth,
    read_token: String,
    static_dir: PathBuf,
}

type AppState = Arc<Inner>;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error("{0}")]
    Config(&'static str),
}

/// Build the router. Opens (and creates the schema of) the SQLite file at `settings.db_path`.
pub fn create_app(settings: &Settings) -> Result<Router, AppError> {
    let store = Store::open(&settings.db_path)?;
    let auth = AdminAuth::new(&settings.admin_password, settings.token_ttl_seconds)
        .map_err(AppError::Config)?;
    let state: AppState = Arc::new(Inner {
        store,
        auth,
        read_token: settings.read_token.clone(),
        static_dir: settings.static_dir.clone(),
    });

    let mut router = Router::new()
        .route("/", get(admin_page))
        .route("/api/health", get(health))
        .route("/api/admin/login", post(login))
        .route(
            "/api/admin/announcements",
            get(list_admin).post(create_admin),
        )
        .route(
            "/api/admin/announcements/{id}",
            patch(patch_admin).delete(delete_admin),
        )
        .route("/api/public/announcements", get(public_feed))
        .fallback(not_found);

    if settings.static_dir.is_dir() {
        router = router.nest_service("/static", ServeDir::new(&settings.static_dir));
    }

    Ok(router
        .layer(from_fn(revalidate_admin_assets))
        .layer(TraceLayer::new_for_http())
        .layer(DefaultBodyLimit::max(MAX_REQUEST_BYTES))
        .with_state(state))
}

/// Errors render as FastAPI's `{"detail": ...}` shape, which the admin page reads.
#[derive(Debug)]
pub enum ApiError {
    Unauthorized(&'static str),
    NotFound(&'static str),
    Invalid(String),
    ServerError(&'static str),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, detail) = match self {
            ApiError::Unauthorized(msg) => (StatusCode::UNAUTHORIZED, msg.to_string()),
            ApiError::NotFound(msg) => (StatusCode::NOT_FOUND, msg.to_string()),
            ApiError::Invalid(msg) => (StatusCode::UNPROCESSABLE_ENTITY, msg),
            ApiError::ServerError(msg) => (StatusCode::INTERNAL_SERVER_ERROR, msg.to_string()),
        };
        (status, Json(serde_json::json!({ "detail": detail }))).into_response()
    }
}

/// Runs a blocking store call off the async workers; any failure becomes a logged 500.
async fn blocking<T, F>(operation: F) -> Result<T, ApiError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, StoreError> + Send + 'static,
{
    match tokio::task::spawn_blocking(operation).await {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(error)) => {
            tracing::error!(%error, "store operation failed");
            Err(ApiError::ServerError("internal error"))
        }
        Err(error) => {
            tracing::error!(%error, "store task panicked or was cancelled");
            Err(ApiError::ServerError("internal error"))
        }
    }
}

// ---------------------------------------------------------------- middleware

/// Admin assets carry no version in their URL, so always revalidate.
///
/// Without a Cache-Control header the browser applies heuristic freshness and
/// keeps serving the previous admin.css/js after an upgrade changed them.
async fn revalidate_admin_assets(request: Request, next: Next) -> Response {
    let is_api = request.uri().path().starts_with("/api/");
    let mut response = next.run(request).await;
    if !is_api {
        response
            .headers_mut()
            .entry(CACHE_CONTROL)
            .or_insert(HeaderValue::from_static("no-cache"));
    }
    response
}

// ---------------------------------------------------------------- helpers

/// `Authorization: Bearer <value>` → `<value>`; anything else is `""`.
fn bearer(headers: &HeaderMap) -> &str {
    let Some(value) = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
    else {
        return "";
    };
    let (scheme, rest) = value.split_once(' ').unwrap_or((value, ""));
    if scheme.eq_ignore_ascii_case("bearer") {
        rest.trim()
    } else {
        ""
    }
}

fn require_admin(state: &AppState, headers: &HeaderMap) -> Result<(), ApiError> {
    if state.auth.verify(bearer(headers)) {
        Ok(())
    } else {
        Err(ApiError::Unauthorized("admin token required"))
    }
}

fn parse_object(body: &[u8]) -> Result<Map<String, Value>, ApiError> {
    match serde_json::from_slice::<Value>(body) {
        Ok(Value::Object(map)) => Ok(map),
        _ => Err(ApiError::Invalid(
            "request body must be a JSON object".to_string(),
        )),
    }
}

/// Optional string field with a length bound counted in characters, as pydantic did.
fn text_field(
    map: &Map<String, Value>,
    key: &str,
    min: usize,
    max: usize,
) -> Result<Option<String>, ApiError> {
    match map.get(key) {
        None => Ok(None),
        Some(Value::String(value)) => {
            let len = value.chars().count();
            if len < min || len > max {
                Err(ApiError::Invalid(format!(
                    "{key} must be {min} to {max} characters"
                )))
            } else {
                Ok(Some(value.clone()))
            }
        }
        Some(_) => Err(ApiError::Invalid(format!("{key} must be a string"))),
    }
}

fn status_field(map: &Map<String, Value>) -> Result<Option<String>, ApiError> {
    match map.get("status") {
        None => Ok(None),
        Some(Value::String(status)) if STATUSES.contains(&status.as_str()) => {
            Ok(Some(status.clone()))
        }
        Some(_) => Err(ApiError::Invalid(format!(
            "status must be one of {}",
            STATUSES.join(", ")
        ))),
    }
}

fn feed_etag(items: &[Announcement]) -> String {
    let mut digest = Sha256::new();
    for item in items {
        digest.update(
            format!(
                "{}:{}:{};",
                item.id, item.content_version, item.published_at
            )
            .as_bytes(),
        );
    }
    format!("\"{}\"", hex_prefix(&digest.finalize(), 16))
}

/// Weak-safe If-None-Match check; `*` never matches the single feed.
fn etag_matches(header: Option<&HeaderValue>, etag: &str) -> bool {
    let Some(header) = header.and_then(|value| value.to_str().ok()) else {
        return false;
    };
    header.split(',').map(str::trim).any(|candidate| {
        let candidate = candidate.strip_prefix("W/").unwrap_or(candidate);
        candidate == etag
    })
}

// ---------------------------------------------------------------- handlers

async fn health() -> Json<Value> {
    Json(serde_json::json!({ "ok": true }))
}

async fn not_found() -> ApiError {
    ApiError::NotFound("Not Found")
}

async fn admin_page(State(state): State<AppState>) -> Result<Html<String>, ApiError> {
    let page = state.static_dir.join("index.html");
    match tokio::fs::read_to_string(&page).await {
        Ok(html) => Ok(Html(html)),
        Err(_) => Err(ApiError::ServerError("admin page is missing")),
    }
}

async fn login(State(state): State<AppState>, body: Bytes) -> Result<Json<Value>, ApiError> {
    let map = parse_object(&body)?;
    let password = text_field(&map, "password", 1, MAX_PASSWORD_CHARS)?
        .ok_or_else(|| ApiError::Invalid("password is required".to_string()))?;
    if !state.auth.check_password(&password) {
        return Err(ApiError::Unauthorized("wrong password"));
    }
    let (token, expires_at) = state.auth.issue();
    Ok(Json(
        serde_json::json!({ "token": token, "expires_at": expires_at }),
    ))
}

async fn list_admin(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    require_admin(&state, &headers)?;
    let store = state.store.clone();
    let items = blocking(move || store.list_all()).await?;
    Ok(Json(serde_json::json!({ "items": items })))
}

async fn create_admin(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<(StatusCode, Json<Announcement>), ApiError> {
    require_admin(&state, &headers)?;
    let map = parse_object(&body)?;

    let title = text_field(&map, "title", 1, MAX_TITLE_CHARS)?
        .ok_or_else(|| ApiError::Invalid("title is required".to_string()))?;
    let body_md = text_field(&map, "body_md", 0, MAX_BODY_CHARS)?.unwrap_or_default();
    // published_at may be null on create (meaning "now"); on patch null is rejected.
    let published_at = match map.get("published_at") {
        Some(Value::Null) => None,
        _ => text_field(&map, "published_at", 0, MAX_PUBLISHED_AT_CHARS)?,
    };
    let status = status_field(&map)?.unwrap_or_else(|| PUBLISHED.to_string());

    let store = state.store.clone();
    let created = blocking(move || {
        store.create(NewAnnouncement {
            title,
            body_md,
            published_at,
            status,
        })
    })
    .await?;
    Ok((StatusCode::CREATED, Json(created)))
}

async fn patch_admin(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(announcement_id): Path<String>,
    body: Bytes,
) -> Result<Json<Announcement>, ApiError> {
    require_admin(&state, &headers)?;
    let map = parse_object(&body)?;

    let changes = AnnouncementChanges {
        title: text_field(&map, "title", 1, MAX_TITLE_CHARS)?,
        body_md: text_field(&map, "body_md", 0, MAX_BODY_CHARS)?,
        published_at: text_field(&map, "published_at", 0, MAX_PUBLISHED_AT_CHARS)?,
        status: status_field(&map)?,
    };
    if changes.is_empty() {
        return Err(ApiError::Invalid("no fields to update".to_string()));
    }

    let store = state.store.clone();
    let updated = blocking(move || store.update(&announcement_id, &changes)).await?;
    updated
        .map(Json)
        .ok_or(ApiError::NotFound("announcement not found"))
}

async fn delete_admin(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(announcement_id): Path<String>,
) -> Result<StatusCode, ApiError> {
    require_admin(&state, &headers)?;
    let store = state.store.clone();
    let removed = blocking(move || store.delete(&announcement_id)).await?;
    if removed {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ApiError::NotFound("announcement not found"))
    }
}

async fn public_feed(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    if !state.read_token.is_empty() {
        let supplied = bearer(&headers);
        if !bool::from(supplied.as_bytes().ct_eq(state.read_token.as_bytes())) {
            return Err(ApiError::Unauthorized("read token required"));
        }
    }

    let store = state.store.clone();
    let items = blocking(move || store.list_published()).await?;
    let etag = feed_etag(&items);
    let etag_value =
        HeaderValue::from_str(&etag).map_err(|_| ApiError::ServerError("internal error"))?;

    if etag_matches(headers.get(IF_NONE_MATCH), &etag) {
        return Ok((
            StatusCode::NOT_MODIFIED,
            [
                (ETAG, etag_value),
                (CACHE_CONTROL, HeaderValue::from_static("no-cache")),
            ],
        )
            .into_response());
    }

    let public: Vec<PublicAnnouncement> = items.iter().map(PublicAnnouncement::from).collect();
    Ok((
        [
            (ETAG, etag_value),
            (CACHE_CONTROL, HeaderValue::from_static("no-cache")),
        ],
        Json(serde_json::json!({ "items": public })),
    )
        .into_response())
}
