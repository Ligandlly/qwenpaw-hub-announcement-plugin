#!/bin/sh
# Start the central announcement service. Requires: pip install fastapi uvicorn
set -eu
cd "$(dirname "$0")"
exec "${PYTHON:-python3}" -m announcement_service
