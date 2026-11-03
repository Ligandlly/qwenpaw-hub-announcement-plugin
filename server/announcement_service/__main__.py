# -*- coding: utf-8 -*-
"""``python -m announcement_service`` — one process, one SQLite file."""

from __future__ import annotations

import os

import uvicorn

from .app import Settings, create_app


def main() -> None:
    settings = Settings.from_env()
    app = create_app(settings)
    uvicorn.run(
        app,
        host=os.environ.get("ANNOUNCEMENT_HOST", "0.0.0.0"),
        port=int(os.environ.get("ANNOUNCEMENT_PORT", "8899")),
        log_level=os.environ.get("ANNOUNCEMENT_LOG_LEVEL", "info"),
    )


if __name__ == "__main__":
    main()
