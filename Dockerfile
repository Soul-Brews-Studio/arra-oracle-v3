# arra-oracle-v3 — multi-target image
#   Default target: http-server  (port 47778)
#   Alt target:     mcp-stdio    (stdio JSON-RPC MCP server)
#   Test target:    test         (self-contained bun test + tsc)
#
# Build:
#   docker build -t arra-oracle-v3 .
#   docker build -t arra-oracle-v3:http --target http-server .
#   docker build -t arra-oracle-v3:stdio --target mcp-stdio .
#   docker build -t arra-test:test --target test .

FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY frontend/package.json ./frontend/package.json
RUN bun install --production --frozen-lockfile \
 && rm -rf node_modules/@lancedb/lancedb-*-musl

FROM deps AS builder
COPY tsconfig.json ./
COPY packages ./packages
COPY src ./src
RUN bun build src/server.ts src/index.ts --target bun --outdir dist

FROM oven/bun:1 AS test
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
ENV HOME=/tmp \
    ORACLE_DATA_DIR=/tmp/oracle \
    ORACLE_LOG_TARGET=stderr \
    PATH=/app/node_modules/.bin:$PATH
COPY package.json bun.lock ./
COPY frontend/package.json ./frontend/package.json
RUN bun install --frozen-lockfile \
 && cd frontend \
 && bun install \
 && cd /app \
 && rm -rf node_modules/@lancedb/lancedb-*-musl
COPY . .
CMD ["sh", "-c", "bun test --isolate && tsc --noEmit"]

FROM oven/bun:1-slim AS production
WORKDIR /app
ENV HOME=/data \
    ORACLE_DATA_DIR=/data \
    BUN_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/db/migrations ./db/migrations
COPY package.json bun.lock ./
RUN mkdir -p /data \
 && chown -R bun:bun /data
USER bun
VOLUME ["/data"]

FROM production AS mcp-stdio
ENV ORACLE_LOG_TARGET=stderr
CMD ["bun", "dist/index.js"]

FROM production AS http-server
ENV ORACLE_PORT=47778 \
    PORT=47778
EXPOSE 47778
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "const r=await fetch('http://127.0.0.1:47778/api/health');process.exit(r.ok?0:1)"
CMD ["bun", "dist/server.js"]
