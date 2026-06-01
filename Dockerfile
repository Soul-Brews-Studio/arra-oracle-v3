# arra-oracle-v3 — HTTP server image (FTS5-only / lean, multi-stage)
#
# Vector search degrades gracefully to SQLite FTS5 when no Ollama embedding
# backend is reachable — so this image is fully functional standalone.
# To enable semantic vector search later, set VECTOR_URL via -e at run time.
#
# Build:  docker build -t arra-oracle-v3 .
# Run:    docker run -p 47778:47778 -v arra-data:/data arra-oracle-v3
# Health: curl -sf http://localhost:47778/api/health

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
# Stage 2 — runtime: slim base + only what the server needs to run
# ─────────────────────────────────────────────────────────────────────────
FROM oven/bun:1-slim
WORKDIR /app

# HOME must be set — src/config.ts fails fast without it.
# ORACLE_DATA_DIR holds SQLite (oracle.db), LanceDB collections, and the ψ/ vault.
ENV HOME=/data \
    ORACLE_DATA_DIR=/data \
    ORACLE_PORT=47778

# Pruned production node_modules from the builder (glibc lancedb binary only).
COPY --from=builder /app/node_modules ./node_modules
# Runtime source only — migrations live in src/db/migrations/*.sql, so src/
# covers them. bin/cli/docs/e2e/tests/web/services are not needed to serve.
COPY package.json bun.lock ./
COPY src ./src

# Persistent state lives here — mount a volume to keep the index across runs.
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 47778

CMD ["bun", "src/server.ts"]
