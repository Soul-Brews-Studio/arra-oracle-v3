# arra-oracle-v3 — multi-target image
#   Default target: http-server  (port 47778)
#   Alt target:     mcp-stdio    (stdio JSON-RPC MCP server)
#
# Build:
#   docker build -t arra-oracle-v3 .
#   docker build -t arra-oracle-v3:http --target http-server .
#   docker build -t arra-oracle-v3:stdio --target mcp-stdio .

FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile \
 && rm -rf node_modules/@lancedb/lancedb-*-musl

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
