//! Environment resolution: required password, defaults, empty-as-unset, port parsing.

use std::collections::HashMap;

use announcement_service::config::{default_static_dir, ConfigError, Settings, DEFAULT_PORT};
use std::path::PathBuf;

fn lookup(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
    let map: HashMap<String, String> = pairs
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
    move |key: &str| map.get(key).cloned()
}

#[test]
fn password_is_required() {
    assert_eq!(
        Settings::from_lookup(lookup(&[])).unwrap_err(),
        ConfigError::MissingPassword
    );
    assert_eq!(
        Settings::from_lookup(lookup(&[("ANNOUNCEMENT_ADMIN_PASSWORD", "")])).unwrap_err(),
        ConfigError::MissingPassword
    );
}

#[test]
fn defaults_match_the_python_service() {
    let settings = Settings::from_lookup(lookup(&[("ANNOUNCEMENT_ADMIN_PASSWORD", "pw")])).unwrap();
    assert_eq!(settings.db_path, PathBuf::from("./data/announcements.db"));
    assert_eq!(settings.read_token, "");
    assert_eq!(settings.static_dir, default_static_dir());
    assert_eq!(settings.host, "0.0.0.0");
    assert_eq!(settings.port, DEFAULT_PORT);
    assert_eq!(settings.port, 8899);
    assert_eq!(settings.log_level, "info");
    assert_eq!(settings.token_ttl_seconds, 12 * 60 * 60);
}

#[test]
fn explicit_values_override_defaults() {
    let settings = Settings::from_lookup(lookup(&[
        ("ANNOUNCEMENT_ADMIN_PASSWORD", "pw"),
        ("ANNOUNCEMENT_DB", "/var/lib/ann.db"),
        ("ANNOUNCEMENT_READ_TOKEN", "tok"),
        ("ANNOUNCEMENT_HOST", "127.0.0.1"),
        ("ANNOUNCEMENT_PORT", "9000"),
        ("ANNOUNCEMENT_STATIC_DIR", "/srv/static"),
        ("ANNOUNCEMENT_LOG_LEVEL", "debug"),
    ]))
    .unwrap();
    assert_eq!(settings.db_path, PathBuf::from("/var/lib/ann.db"));
    assert_eq!(settings.read_token, "tok");
    assert_eq!(settings.host, "127.0.0.1");
    assert_eq!(settings.port, 9000);
    assert_eq!(settings.static_dir, PathBuf::from("/srv/static"));
    assert_eq!(settings.log_level, "debug");
}

#[test]
fn empty_values_count_as_unset() {
    let settings = Settings::from_lookup(lookup(&[
        ("ANNOUNCEMENT_ADMIN_PASSWORD", "pw"),
        ("ANNOUNCEMENT_HOST", ""),
        ("ANNOUNCEMENT_PORT", ""),
    ]))
    .unwrap();
    assert_eq!(settings.host, "0.0.0.0");
    assert_eq!(settings.port, 8899);
}

#[test]
fn invalid_port_is_reported() {
    let error = Settings::from_lookup(lookup(&[
        ("ANNOUNCEMENT_ADMIN_PASSWORD", "pw"),
        ("ANNOUNCEMENT_PORT", "http"),
    ]))
    .unwrap_err();
    assert_eq!(error, ConfigError::InvalidPort("http".to_string()));
}
