ARG NODE_IMAGE=node:22.23.1-bookworm-slim

FROM ${NODE_IMAGE} AS frontend-deps

WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

FROM ${NODE_IMAGE} AS frontend-builder

WORKDIR /src/frontend
COPY --from=frontend-deps /src/frontend/node_modules ./node_modules
COPY frontend/ ./
RUN npm run build && \
    server_path="$(find .next/standalone -type f -name server.js -exec sh -c \
      'for candidate do candidate_root=${candidate%/*}; if [ -d "$candidate_root/.next" ] && [ -f "$candidate_root/package.json" ]; then echo "$candidate"; fi; done' \
      sh {} +)" && \
    test -n "$server_path" && \
    test "$(printf '%s\n' "$server_path" | wc -l)" -eq 1 && \
    standalone_root="$(dirname "$server_path")" && \
    mkdir -p /out/frontend/.next && \
    cp -a "$standalone_root/." /out/frontend/ && \
    cp -a .next/static /out/frontend/.next/static && \
    cp -a public /out/frontend/public && \
    test -f /out/frontend/server.js

FROM golang:1.26-alpine AS backend-builder

WORKDIR /src
ARG GOPROXY=https://proxy.golang.org,direct
ARG TOKENHUB_VERSION=0.10.0
ARG TOKENHUB_BUILD_TYPE=source
ENV GOPROXY=$GOPROXY
RUN apk add --no-cache gcc musl-dev
COPY backend/go.mod ./backend/go.mod
COPY backend/go.sum ./backend/go.sum
COPY backend/cmd ./backend/cmd
COPY backend/internal ./backend/internal
RUN cd backend && \
    case "$TOKENHUB_BUILD_TYPE" in source|release) ;; *) exit 1 ;; esac && \
    CGO_ENABLED=1 go build \
      -tags "netgo osusergo" \
      -trimpath \
      -ldflags="-s -w -linkmode external -extldflags '-static' -X main.buildVersion=${TOKENHUB_VERSION} -X main.buildType=${TOKENHUB_BUILD_TYPE} -X main.deploymentType=container" \
      -o /out/tokenstation ./cmd/tokenstation

FROM ${NODE_IMAGE}

ARG TOKENHUB_VERSION=0.10.0
LABEL org.opencontainers.image.version="${TOKENHUB_VERSION}"

COPY --from=backend-builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
RUN command -v bash >/dev/null && \
    command -v setpriv >/dev/null && \
    test -s /etc/ssl/certs/ca-certificates.crt

ENV NODE_ENV=production \
    TOKENHUB_DEPLOYMENT_TYPE=container \
    TOKENHUB_INSTALL_ROOT=/opt/tokenhub \
    TOKENHUB_MODEL_CATALOG_FILE=/opt/tokenhub/current/catalog/model-catalog.yaml \
    TOKENHUB_PROVIDER_CATALOG_FILE=/opt/tokenhub/current/catalog/provider-catalog.json \
    TOKENHUB_RUN_MODE=all

WORKDIR /app
COPY --from=backend-builder --chown=node:node /out/tokenstation /usr/local/lib/tokenstation-image/bin/tokenstation
COPY --from=frontend-builder --chown=node:node /usr/local/bin/node /usr/local/lib/tokenstation-image/bin/node
COPY --from=frontend-builder --chown=node:node /out/frontend /usr/local/lib/tokenstation-image/frontend
COPY --chown=node:node deploy/native/tokenstation-run /usr/local/lib/tokenstation-image/bin/tokenstation-run
COPY --chown=node:node deploy/native/tokenstation.service /usr/local/lib/tokenstation-image/deploy/tokenstation.service
COPY --chown=node:node data/model-catalog.yaml /usr/local/lib/tokenstation-image/catalog/model-catalog.yaml
COPY --chown=node:node data/provider-catalog.json /usr/local/lib/tokenstation-image/catalog/provider-catalog.json
COPY --chown=node:node data/builtin-plugins /usr/local/lib/tokenstation-image/catalog/builtin-plugins
COPY deploy/container/tokenstation-build-id /usr/local/bin/tokenstation-build-id
COPY deploy/container/tokenstation-entrypoint /usr/local/bin/tokenstation-entrypoint

RUN printf '%s\n' '#!/bin/sh' 'exec "$(dirname "$0")/tokenstation-run" "$@"' >/usr/local/lib/tokenstation-image/bin/tokenhub-run && \
    chmod 0755 /usr/local/lib/tokenstation-image/bin/tokenhub-run && \
    printf '%s\n' "$TOKENHUB_VERSION" >/usr/local/lib/tokenstation-image/VERSION && \
    chmod 0755 \
      /usr/local/bin/tokenstation-build-id \
      /usr/local/bin/tokenstation-entrypoint \
      /usr/local/lib/tokenstation-image/bin/node \
      /usr/local/lib/tokenstation-image/bin/tokenstation \
      /usr/local/lib/tokenstation-image/bin/tokenstation-run && \
    tokenstation-build-id /usr/local/lib/tokenstation-image && \
    chown -R node:node /usr/local/lib/tokenstation-image && \
    mkdir -p /app/data /app/plugins /opt/tokenhub && \
    chown node:node /app/data /app/plugins /opt/tokenhub

EXPOSE 8080 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=12 \
  CMD node -e "Promise.all([fetch('http://127.0.0.1:8080/healthz'),fetch('http://127.0.0.1:3000')]).then(rs=>process.exit(rs.every(r=>r.ok)?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/tokenstation-entrypoint"]
