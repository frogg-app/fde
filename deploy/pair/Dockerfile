# syntax=docker/dockerfile:1
#
# The standalone FDE pairing page (`https://pair.frogg.app/code/<code>`).
#
# It renders the same page a daemon serves at `GET /code/:code`, built from the
# same sources, but with no daemon behind it: pairing codes carry the whole
# offer in the URL, so the service is stateless and never talks to anyone's
# daemon. Point the hostname in `app.pairingBaseUrl` at it and every FDE
# install's pairing links resolve to a page that hands the code to the app.
#
# Stage 1 bundles the service into one file with esbuild (no monorepo install
# and no native modules); stage 2 runs it on a plain Node image.
#
# Build from the repository root:
#   docker build -f deploy/pair/Dockerfile -t froggapp/fde-pair-page .
# or scripts/release/build-pair-page-docker.sh, which applies the version tags.

FROM node:22-bookworm-slim AS build
ARG FDE_BRAND_DIR=brands/fde
ARG FDE_SOURCE_REVISION=unknown
ENV FDE_BRAND_DIR=${FDE_BRAND_DIR} FDE_SOURCE_REVISION=${FDE_SOURCE_REVISION} ONNXRUNTIME_NODE_INSTALL=skip
WORKDIR /build
COPY . .
RUN npm ci --ignore-scripts --no-audit --no-fund && node packages/server/scripts/build-pair-page.mjs

FROM node:22-alpine

ENV NODE_ENV=production \
    FDE_PAIR_HOST=0.0.0.0 \
    FDE_PAIR_PORT=8787

WORKDIR /app
COPY --from=build /build/packages/server/dist/pair-page/server.cjs ./server.cjs

USER node
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.FDE_PAIR_PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "/app/server.cjs"]
