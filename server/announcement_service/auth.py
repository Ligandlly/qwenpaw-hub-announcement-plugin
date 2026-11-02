# -*- coding: utf-8 -*-
"""Single-password admin auth: password in, HMAC bearer token out.

No user table, no second identity system.  The token is
``base64url(payload).base64url(hmac_sha256(key, base64url(payload)))`` where the
payload carries only an expiry, so the service stays stateless and a restart
keeps every valid token alive (the key is derived from the password).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Optional, Tuple

DEFAULT_TTL_SECONDS = 12 * 60 * 60


def _b64encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64decode(text: str) -> bytes:
    padding = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode(text + padding)


class AdminAuth:
    """Issue and verify admin tokens for one configured password."""

    def __init__(self, password: str, ttl_seconds: int = DEFAULT_TTL_SECONDS) -> None:
        if not password:
            raise ValueError("an admin password is required")
        self._password = password
        self.ttl_seconds = ttl_seconds
        self._key = hashlib.sha256(
            f"qwenpaw-hub-announcement:{password}".encode("utf-8"),
        ).digest()

    def check_password(self, candidate: str) -> bool:
        return hmac.compare_digest(candidate, self._password)

    def issue(self) -> Tuple[str, int]:
        """Return ``(token, expires_at_epoch_seconds)``."""
        expires_at = int(time.time()) + self.ttl_seconds
        payload = _b64encode(json.dumps({"exp": expires_at}).encode("utf-8"))
        signature = _b64encode(hmac.new(self._key, payload.encode("ascii"), hashlib.sha256).digest())
        return f"{payload}.{signature}", expires_at

    def verify(self, token: Optional[str]) -> bool:
        if not token:
            return False
        payload, _, signature = token.partition(".")
        if not payload or not signature:
            return False
        expected = _b64encode(hmac.new(self._key, payload.encode("ascii"), hashlib.sha256).digest())
        if not hmac.compare_digest(signature, expected):
            return False
        try:
            data = json.loads(_b64decode(payload))
            expires_at = int(data["exp"])
        except (ValueError, KeyError, TypeError):
            return False
        return expires_at > int(time.time())
