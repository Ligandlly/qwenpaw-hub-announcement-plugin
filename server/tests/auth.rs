//! Token format: round trip, forgery, expiry, and compatibility with tokens the Python service issued.

use announcement_service::auth::AdminAuth;

/// Issued by the earlier Python `AdminAuth("s3cret", ttl_seconds=10**10)`.
const PYTHON_ISSUED: &str =
    "eyJleHAiOiAxMTc5MzgwMTExNn0.OJ5u-KfiQiCj-iaCDaOuJ-bepd-5qPpJc9RuIqLTAD0";

#[test]
fn issued_token_verifies() {
    let auth = AdminAuth::new("s3cret", 3600).unwrap();
    let (token, expires_at) = auth.issue();
    assert!(auth.verify(&token));
    assert!(expires_at > 0);
}

#[test]
fn token_from_the_python_service_still_verifies() {
    let auth = AdminAuth::new("s3cret", 3600).unwrap();
    assert!(auth.verify(PYTHON_ISSUED));
}

#[test]
fn token_is_bound_to_the_password() {
    let other = AdminAuth::new("another", 3600).unwrap();
    assert!(!other.verify(PYTHON_ISSUED));
}

#[test]
fn forged_and_malformed_tokens_are_rejected() {
    let auth = AdminAuth::new("s3cret", 3600).unwrap();
    assert!(!auth.verify(""));
    assert!(!auth.verify("abc.def"));
    assert!(!auth.verify(".sig"));
    assert!(!auth.verify("payload."));
    assert!(!auth.verify("no-dot-here"));
    let (token, _) = auth.issue();
    let (payload, _) = token.split_once('.').unwrap();
    assert!(!auth.verify(&format!("{payload}.AAAA")));
}

#[test]
fn expired_tokens_are_rejected() {
    let auth = AdminAuth::new("s3cret", -10).unwrap();
    let (token, _) = auth.issue();
    assert!(!auth.verify(&token));
}

#[test]
fn password_check_is_exact() {
    let auth = AdminAuth::new("s3cret", 3600).unwrap();
    assert!(auth.check_password("s3cret"));
    assert!(!auth.check_password("s3cre"));
    assert!(!auth.check_password("s3cret "));
}

#[test]
fn empty_password_is_refused() {
    assert!(AdminAuth::new("", 3600).is_err());
}
