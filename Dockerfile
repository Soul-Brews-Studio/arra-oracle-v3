# arra-oracle-v3 — multi-target image
#   Default target: http-server  (port 47778, used by docker-compose.yml)
#   Alt target:     mcp-stdio    (no port, stdio MCP — for Docker MCP Toolkit)
#
# Vector search degrades gracefully to SQLite FTS5 when no Ollama embedding
# backend is reachable — so both images are fully functional standalone.
#
# Build:
#   docker build -t arra-oracle-v3 .                              # default = http-server
#   docker build -t arra-oracle-v3:http   --target http-server .  # explicit HTTP server
#   docker build -t arra-oracle-v3:stdio  --target mcp-stdio .    # MCP stdio variant
#
# Run http-server (current behavior):
#   docker run -p 47778:47778 -v arra-data:/data arra-oracle-v3
#
# Run mcp-stdio (manual; Docker MCP Gateway normally does this):
#   docker run -i --rm -v arra-data:/data arra-oracle-v3:stdio

# ─────────────────────────────────────────────────────────────────────────
# Stage 1 — builder: resolve production deps, prune cross-arch dead weight
# ─────────────────────────────────────────────────────────────────────────
FROM oven/bun:1 AS builder
WORKDIR /app

# --production drops devDependencies (drizzle-kit, better-sqlite3, typescript,
#   @types/*, bun-types) — none are used at server runtime. The server runs on
#   Bun's built-in bun:sqlite + drizzle-orm (a real dep, pure JS). Dropping
#   better-sqlite3 also removes its node-gyp build, so no toolchain is needed.
# --ignore-scripts is belt-and-suspenders against any other postinstall.
COPY package.json bun.lock ./
RUN bun install --production --ignore-scripts \
 && rm -rf node_modules/@lancedb/lancedb-*-musl

# ─────────────────────────────────────────────────────────────────────────
# Stage 2 — base runtime: shared deps + source for all final targets
# ─────────────────────────────────────────────────────────────────────────
FROM oven/bun:1-slim AS base
WORKDIR /app

# HOME must be set — src/config.ts fails fast without it.
# ORACLE_DATA_DIR holds SQLite (oracle.db), LanceDB collections, and the ψ/ vault.
ENV HOME=/data \
    ORACLE_DATA_DIR=/data

# Pruned production node_modules from the builder (glibc lancedb binary only).
COPY --from=builder /app/node_modules ./node_modules
# Runtime source only — migrations live in src/db/migrations/*.sql, so src/
# covers them. bin/cli/docs/e2e/tests/web/services are not needed to serve.
COPY package.json bun.lock ./
COPY src ./src

# Persistent state lives here — mount a volume to keep the index across runs.
RUN mkdir -p /data
VOLUME ["/data"]

# ─────────────────────────────────────────────────────────────────────────
# Target — mcp-stdio (for Docker MCP Toolkit + Gateway)
# ─────────────────────────────────────────────────────────────────────────
# This target speaks JSON-RPC on stdin/stdout. NO port, NO stdout logs
# (the codex-killer bug — see PR #1238). Docker MCP Gateway spawns this
# container transiently per MCP call.
FROM base AS mcp-stdio
# Force any incidental logging to stderr — protect the stdio JSON-RPC channel.
ENV ORACLE_LOG_TARGET=stderr
CMD ["bun", "src/index.ts"]

# ─────────────────────────────────────────────────────────────────────────
# Target — http-server (DEFAULT; current docker-compose behavior)
# ─────────────────────────────────────────────────────────────────────────
# Keep this as the final stage so `docker build .` and docker-compose continue
# to produce the HTTP server image unless an explicit --target is provided.
FROM base AS http-server
ENV ORACLE_PORT=47778
EXPOSE 47778
CMD ["bun", "src/server.ts"]
