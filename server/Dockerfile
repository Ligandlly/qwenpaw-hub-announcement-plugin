# Central announcement service, as a minimal image: one static binary on
# `scratch`, plus the admin page, a passwd entry for a non-root user, and /data.
#
#   docker build -t hub-announcement-service ./server     (from the repo root)
#   docker run -p 8899:8899 -e ANNOUNCEMENT_ADMIN_PASSWORD=... \
#     -v announcements:/data hub-announcement-service
#
# The build stage is Alpine, so cargo targets musl and produces a fully static
# binary (SQLite is bundled via rusqlite, no shared libraries are needed). The
# runtime stage has no OS at all, so the image is roughly the size of the binary.

FROM rust:1-alpine AS build
WORKDIR /src
RUN apk add --no-cache musl-dev

# Crate downloads go through the TUNA mirror by default (much faster from CN).
# Pass an empty mirror to use crates.io directly, as CI does:
#   --build-arg CARGO_REGISTRY_MIRROR=
# TUNA refuses some non-CN egress addresses (HTTP 403 on its IPv4 node) and its
# index can lag behind crates.io, either of which breaks a `--locked` build; the
# build then retries once through the fallback mirror.
# Source *replacement* keeps Cargo.lock's crates.io identity, so `--locked` and
# the recorded checksums stay valid.
ARG CARGO_REGISTRY_MIRROR=sparse+https://mirrors.tuna.tsinghua.edu.cn/crates.io-index/
ARG CARGO_REGISTRY_MIRROR_FALLBACK=sparse+https://rsproxy.cn/index/

# Strip symbols; the image only needs the runnable file.
ENV CARGO_PROFILE_RELEASE_STRIP=true

# Compile dependencies from a manifest-only layer so source edits don't rebuild
# every crate. The stub keeps `cargo build` happy until real sources are copied.
COPY Cargo.toml Cargo.lock ./
RUN set -eu \
 && mkdir -p /src/.cargo src \
 && printf 'pub fn _stub() {}\n' > src/lib.rs \
 && printf 'fn main() {}\n' > src/main.rs \
 && use_mirror() { \
      if [ -z "$1" ]; then rm -f /src/.cargo/config.toml; return 0; fi; \
      printf '[source.crates-io]\nreplace-with = "mirror"\n\n[source.mirror]\nregistry = "%s"\n' \
        "$1" > /src/.cargo/config.toml; \
    } \
 && use_mirror "$CARGO_REGISTRY_MIRROR" \
 && { cargo build --release --locked --bin hub-announcement-service \
      || { if [ -z "$CARGO_REGISTRY_MIRROR" ]; then exit 1; fi; \
           echo "warning: $CARGO_REGISTRY_MIRROR cannot satisfy Cargo.lock; retrying via $CARGO_REGISTRY_MIRROR_FALLBACK" >&2; \
           rm -rf target; use_mirror "$CARGO_REGISTRY_MIRROR_FALLBACK"; \
           cargo build --release --locked --bin hub-announcement-service; }; } \
 && rm -rf src target/release/hub-announcement-service \
    target/release/deps/hub_announcement_service* \
    target/release/deps/announcement_service* \
    target/release/libannouncement_service*

COPY src ./src
COPY static ./static
# COPY keeps the repo's older mtimes, which cargo would treat as up to date
# against the stub build; touch so the real crate is rebuilt.
RUN find src -name '*.rs' -exec touch {} + \
 && cargo build --release --locked --bin hub-announcement-service \
 && mkdir -p /out/usr/local/bin /out/app /out/data /out/etc \
 && cp target/release/hub-announcement-service /out/usr/local/bin/ \
 && cp -r static /out/app/static \
 && printf 'root:x:0:\nannouncement:x:10001:\n' > /out/etc/group \
 && printf 'root:x:0:0:root:/:/sbin/nologin\nannouncement:x:10001:10001::/data:/sbin/nologin\n' > /out/etc/passwd \
 && chown -R 10001:10001 /out/data

FROM scratch

COPY --from=build /out/ /

ENV ANNOUNCEMENT_DB=/data/announcements.db \
    ANNOUNCEMENT_STATIC_DIR=/app/static \
    ANNOUNCEMENT_HOST=0.0.0.0 \
    ANNOUNCEMENT_PORT=8899 \
    ANNOUNCEMENT_LOG_LEVEL=info

USER 10001:10001
WORKDIR /data
EXPOSE 8899

ENTRYPOINT ["/usr/local/bin/hub-announcement-service"]
