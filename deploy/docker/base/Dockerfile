# syntax=docker/dockerfile:1
#
# FDE daemon image. Stage 1 builds the self-contained daemon bundle for the
# target platform (scripts/release/build-daemon-bundle.mjs); stage 2 unpacks
# it into a slim Debian image. The bundle carries its own Node runtime, so the
# runtime image needs no Node installation.
#
# Build with scripts/release/build-docker.sh, which reads the version from the
# root package.json and applies the org tagging rules.

ARG BUILD_NODE_IMAGE=node:22-bookworm-slim
FROM --platform=$BUILDPLATFORM ${BUILD_NODE_IMAGE} AS bundle

ARG FDE_BRAND_DIR=brands/fde
ARG FDE_SOURCE_REVISION=unknown
ENV FDE_BRAND_DIR=${FDE_BRAND_DIR} FDE_SOURCE_REVISION=${FDE_SOURCE_REVISION}
ARG FDE_VERSION
ARG TARGETOS
ARG TARGETARCH

ENV ONNXRUNTIME_NODE_INSTALL=skip

WORKDIR /src
COPY . .

RUN set -eux; \
    if [ -n "${FDE_VERSION:-}" ]; then \
      test "$(node -p "require('./package.json').version")" = "${FDE_VERSION}"; \
    fi; \
    node -e 'const fs=require("node:fs"); const pkg=JSON.parse(fs.readFileSync("package.json","utf8")); delete pkg.scripts.prepare; fs.writeFileSync("package.json", `${JSON.stringify(pkg)}\n`);'; \
    npm ci

RUN set -eux; \
    npm run build:server; \
    npm run build:daemon-web-ui; \
    case "${TARGETARCH}" in \
      amd64) arch=x64 ;; \
      arm64) arch=arm64 ;; \
      *) echo "unsupported TARGETARCH ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    node scripts/release/build-daemon-bundle.mjs --target "${TARGETOS}-${arch}" --out-dir /bundles; \
    mkdir -p /opt/fde; \
    tar -xzf /bundles/*-daemon-*.tar.gz --strip-components=1 -C /opt/fde; \
    rm -rf /bundles

FROM debian:bookworm-slim

ENV HOME=/home/fde \
    PASEO_WEB_UI_ENABLED=true \
    PASEO_LOG_FORMAT=json \
    PASEO_LOG_LEVEL=info \
    CLAUDE_CONFIG_DIR=/home/fde/.claude \
    CODEX_HOME=/home/fde/.codex \
    XDG_CONFIG_HOME=/home/fde/.config \
    XDG_DATA_HOME=/home/fde/.local/share \
    XDG_STATE_HOME=/home/fde/.local/state \
    XDG_CACHE_HOME=/home/fde/.cache \
    PATH=/opt/fde/bin:/opt/fde/node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      bash \
      ca-certificates \
      curl \
      git \
      gosu \
      lbzip2 \
      openssh-client \
      procps \
      tini; \
    rm -rf /var/lib/apt/lists/*

COPY --from=bundle /opt/fde /opt/fde
COPY --from=bundle /src/.generated/branding/deploy/runtime.sh /opt/fde/brand.sh
RUN set -eux; \
    test -f /opt/fde/daemon/packages/server/dist/scripts/supervisor-entrypoint.js; \
    /opt/fde/node/bin/node --version

RUN set -eux; \
    groupadd --gid 1000 fde; \
    useradd --uid 1000 --gid fde --create-home --home-dir /home/fde --shell /bin/bash fde; \
    mkdir -p \
      /workspace \
      "$CLAUDE_CONFIG_DIR" \
      "$CODEX_HOME" \
      "$XDG_CONFIG_HOME" \
      "$XDG_DATA_HOME" \
      "$XDG_STATE_HOME" \
      "$XDG_CACHE_HOME"; \
    chown -R fde:fde /home/fde /workspace

COPY deploy/docker/base/rootfs/ /
RUN chmod +x /usr/local/bin/fde-docker-entrypoint

WORKDIR /workspace



HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD bash -c 'source /opt/fde/brand.sh; port="${PASEO_LISTEN:-$BRAND_PORT}"; curl -fsS "http://127.0.0.1:${port##*:}/api/health" >/dev/null' || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/fde-docker-entrypoint"]
