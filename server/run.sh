#!/bin/sh
# Start the central announcement service. Requires: a Rust toolchain (cargo).
set -eu
cd "$(dirname "$0")"
exec cargo run --release --quiet --bin hub-announcement-service
