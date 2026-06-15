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

FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile \
 && rm -rf node_modules/@lancedb/lancedb-*-musl

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

FROM oven/bun:1-slim AS base
WORKDIR /app
ENV HOME=/data \
    ORACLE_DATA_DIR=/data

COPY --from=builder /app/node_modules ./node_modules
COPY package.json bun.lock ./
COPY bin ./bin
COPY cli ./cli
COPY src ./src

RUN mkdir -p /data
VOLUME ["/data"]

FROM base AS mcp-stdio
ENV ORACLE_LOG_TARGET=stderr
CMD ["bun", "src/index.ts"]

FROM base AS http-server
ENV ORACLE_PORT=47778 \
    PORT=47778
EXPOSE 47778
CMD ["bun", "src/server.ts"]
