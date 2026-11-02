#!/bin/sh
# Build the offline plugin package (a .zip QwenPaw can install directly).
#
#   ./scripts/package.sh [output-dir]
#
# The archive has a single top-level `hub-announcement/` directory, which is the
# layout `qwenpaw plugin install <file>.zip` expects. `frontend/dist/index.js`
# must already be built (`cd frontend && npm run build`; CI does this first).
set -eu

cd "$(dirname "$0")/.."
ROOT=$(pwd)
OUT_DIR=${1:-"$ROOT/dist-packages"}
case "$OUT_DIR" in
  /*) ;;
  *) OUT_DIR="$ROOT/$OUT_DIR" ;;
esac
PLUGIN_ID=hub-announcement

VERSION=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' plugin.json)
ARCHIVE="$OUT_DIR/$PLUGIN_ID-$VERSION.zip"

for required in plugin.json plugin.py frontend/dist/index.js; do
  if [ ! -f "$required" ]; then
    echo "missing $required (build the frontend first: cd frontend && npm install && npm run build)" >&2
    exit 1
  fi
done

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/$PLUGIN_ID"

# Only what the host needs at runtime, plus the docs/config a human needs to
# wire it up. Tests, the server, and the frontend sources stay out.
cp plugin.json "$STAGE/$PLUGIN_ID/"
cp plugin.py "$STAGE/$PLUGIN_ID/"
cp README.md "$STAGE/$PLUGIN_ID/"
cp hub-announcement.config.json "$STAGE/$PLUGIN_ID/"
cp hub-announcement.config.example.json "$STAGE/$PLUGIN_ID/"
mkdir -p "$STAGE/$PLUGIN_ID/frontend/dist"
cp frontend/dist/index.js "$STAGE/$PLUGIN_ID/frontend/dist/"

mkdir -p "$OUT_DIR"
rm -f "$ARCHIVE" "$ARCHIVE.sha256"
(cd "$STAGE" && zip -qr -X "$ARCHIVE" "$PLUGIN_ID")

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$OUT_DIR" && sha256sum "$(basename "$ARCHIVE")" >"$(basename "$ARCHIVE").sha256")
else
  (cd "$OUT_DIR" && shasum -a 256 "$(basename "$ARCHIVE")" >"$(basename "$ARCHIVE").sha256")
fi

echo "built $ARCHIVE"
cat "$ARCHIVE.sha256"
