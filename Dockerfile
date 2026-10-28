# syntax=docker/dockerfile:1.7

# ---- stage 1: build -----------------------------------------
# Pin to Node 22 LTS; the server declares engines >=20.0.0 but we
# publish on the same major as the test matrix.
FROM node:22-bookworm-slim AS build

WORKDIR /src

# Install just the manifest first so the npm cache mounts can reuse
# dependencies across rebuilds that touch only source files.
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund --ignore-scripts

# Then the rest of the tree. `dist/` is gitignored so we rebuild from
# `src/` here — the published layer never carries a stale compile.
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

# ---- stage 2: runtime ---------------------------------------
# -slim gets us a Debian base with glibc; needed because Frida and
# some plugin tooling expect dynamic linker/libstdc++ at runtime,
# which Alpine would make awkward. Still only ~75 MiB base.
FROM node:22-bookworm-slim AS runtime

# dumb-init turns Node into a well-behaved PID 1 inside the
# container — correct SIGTERM/SIGINT handling so `docker stop`
# finishes cleanly without the 10 s kill fallback.
RUN apt-get update \
 && apt-get install -y --no-install-recommends dumb-init \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install only production deps. node_modules shrinks ~40% without
# dev dependencies (tsx / typescript / @types).
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --no-audit --no-fund --ignore-scripts

# Compiled JS + static assets. We ship the gzipped source archives
# (skills/*/source.txt.gz) under skills/ — the server's safeRead
# helper decompresses them on demand, so no unpack step at startup.
COPY --from=build /src/dist ./dist
COPY bin/        ./bin/
COPY skills/     ./skills/
COPY agents/     ./agents/
COPY subagents/  ./subagents/
COPY plugins/    ./plugins/
COPY prompts/    ./prompts/
COPY signatures/ ./signatures/

# Drop to the non-root `node` user baked into the base image.
# All of /app is owned by this user already (COPY --chown would
# just add build time); the runtime scratch dirs are created at
# server startup under /app, which is writable for this uid.
USER node

# Default to HTTP transport on 0.0.0.0 inside the container; let
# the orchestrator (compose / k8s) decide the external binding.
# stdio consumers (Claude Desktop etc.) pass -e MCP_TRANSPORT=stdio.
ENV MCP_TRANSPORT=http \
    MCP_HTTP_HOST=0.0.0.0 \
    MCP_HTTP_PORT=7777 \
    NODE_ENV=production
EXPOSE 7777

# Health probe for compose / k8s. /healthz is always open and
# answers in <5 ms, so we don't need curl in the image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('node:http').get('http://127.0.0.1:7777/healthz', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/index.js"]
