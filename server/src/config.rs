//! Settings resolved once at start-up from `ANNOUNCEMENT_*` environment variables.

use std::path::PathBuf;

use thiserror::Error;

pub const DEFAULT_DB_PATH: &str = "./data/announcements.db";
pub const DEFAULT_HOST: &str = "0.0.0.0";
pub const DEFAULT_PORT: u16 = 8899;
pub const DEFAULT_LOG_LEVEL: &str = "info";
pub const DEFAULT_TOKEN_TTL_SECONDS: i64 = 12 * 60 * 60;

/// The `static/` directory next to this crate, the same default the Python service used.
pub fn default_static_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("static")
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Settings {
    pub db_path: PathBuf,
    pub admin_password: String,
    /// Empty means the tenant feed is public.
    pub read_token: String,
    pub static_dir: PathBuf,
    pub token_ttl_seconds: i64,
    pub host: String,
    pub port: u16,
    pub log_level: String,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ConfigError {
    #[error("ANNOUNCEMENT_ADMIN_PASSWORD is not set")]
    MissingPassword,
    #[error("ANNOUNCEMENT_PORT must be a port number, got {0:?}")]
    InvalidPort(String),
}

impl Settings {
    /// Settings with defaults for everything except the database file and password.
    pub fn new(db_path: impl Into<PathBuf>, admin_password: impl Into<String>) -> Self {
        Self {
            db_path: db_path.into(),
            admin_password: admin_password.into(),
            read_token: String::new(),
            static_dir: default_static_dir(),
            token_ttl_seconds: DEFAULT_TOKEN_TTL_SECONDS,
            host: DEFAULT_HOST.to_string(),
            port: DEFAULT_PORT,
            log_level: DEFAULT_LOG_LEVEL.to_string(),
        }
    }

    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_lookup(|key| std::env::var(key).ok())
    }

    /// Resolve settings from any key lookup. Empty values count as unset.
    pub fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Result<Self, ConfigError> {
        let get = |key: &str| lookup(key).filter(|value| !value.is_empty());

        let admin_password =
            get("ANNOUNCEMENT_ADMIN_PASSWORD").ok_or(ConfigError::MissingPassword)?;
        let port = match get("ANNOUNCEMENT_PORT") {
            Some(raw) => raw
                .parse::<u16>()
                .map_err(|_| ConfigError::InvalidPort(raw))?,
            None => DEFAULT_PORT,
        };

        Ok(Self {
            db_path: get("ANNOUNCEMENT_DB")
                .unwrap_or_else(|| DEFAULT_DB_PATH.to_string())
                .into(),
            admin_password,
            read_token: get("ANNOUNCEMENT_READ_TOKEN").unwrap_or_default(),
            static_dir: get("ANNOUNCEMENT_STATIC_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(default_static_dir),
            token_ttl_seconds: DEFAULT_TOKEN_TTL_SECONDS,
            host: get("ANNOUNCEMENT_HOST").unwrap_or_else(|| DEFAULT_HOST.to_string()),
            port,
            log_level: get("ANNOUNCEMENT_LOG_LEVEL")
                .unwrap_or_else(|| DEFAULT_LOG_LEVEL.to_string()),
        })
    }
}
