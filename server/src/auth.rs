//! Single-password admin auth: password in, HMAC bearer token out.
//!
//! Token format is `base64url(payload).base64url(hmac_sha256(key, base64url(payload)))`
//! where the payload is `{"exp": <epoch seconds>}`. The key is derived from the
//! password, so the service keeps no session state and a restart keeps every
//! valid token alive. This is byte-compatible with the earlier Python service:
//! tokens it issued still verify here.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Clone)]
pub struct AdminAuth {
    password: String,
    key: [u8; 32],
    ttl_seconds: i64,
}

impl AdminAuth {
    pub fn new(password: &str, ttl_seconds: i64) -> Result<Self, &'static str> {
        if password.is_empty() {
            return Err("an admin password is required");
        }
        let key: [u8; 32] =
            Sha256::digest(format!("qwenpaw-hub-announcement:{password}").as_bytes()).into();
        Ok(Self {
            password: password.to_string(),
            key,
            ttl_seconds,
        })
    }

    pub fn check_password(&self, candidate: &str) -> bool {
        bool::from(candidate.as_bytes().ct_eq(self.password.as_bytes()))
    }

    /// Returns `(token, expires_at_epoch_seconds)`.
    pub fn issue(&self) -> (String, i64) {
        let expires_at = now_epoch() + self.ttl_seconds;
        let payload = URL_SAFE_NO_PAD.encode(format!("{{\"exp\": {expires_at}}}"));
        let signature = self.sign(payload.as_bytes());
        (format!("{payload}.{signature}"), expires_at)
    }

    pub fn verify(&self, token: &str) -> bool {
        let Some((payload, signature)) = token.split_once('.') else {
            return false;
        };
        if payload.is_empty() || signature.is_empty() {
            return false;
        }
        let expected = self.sign(payload.as_bytes());
        if !bool::from(signature.as_bytes().ct_eq(expected.as_bytes())) {
            return false;
        }
        let Ok(raw) = URL_SAFE_NO_PAD.decode(payload) else {
            return false;
        };
        let Ok(data) = serde_json::from_slice::<serde_json::Value>(&raw) else {
            return false;
        };
        match data.get("exp").and_then(serde_json::Value::as_i64) {
            Some(expires_at) => expires_at > now_epoch(),
            None => false,
        }
    }

    fn sign(&self, payload: &[u8]) -> String {
        let mut mac = HmacSha256::new_from_slice(&self.key).expect("HMAC accepts any key length");
        mac.update(payload);
        URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
    }
}

fn now_epoch() -> i64 {
    chrono::Utc::now().timestamp()
}
