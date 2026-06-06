# Arra Oracle Installation Guide

Fresh-install guide for the current `arra-oracle-v3` alpha distribution
channels: Bun remote, Docker GHCR, and Docker MCP Toolkit.

For the full alpha operator surface (MCP modes, CLI targets, plugins, vector
adapters, Docker/GHCR, and federation notes), see
[TONIGHT-SHIPPED.md](./TONIGHT-SHIPPED.md).

## Prerequisites

- [Bun](https://bun.sh/) for the Bun remote/source paths.
- Docker Desktop or Docker Engine for Docker/GHCR paths.
- Docker Desktop with Docker MCP Toolkit / `docker mcp` CLI for the Toolkit path.

## Channel 1: Bun remote HTTP server

Start a fresh HTTP server directly from GitHub:

```bash
bunx --bun arra-oracle-v3@github:Soul-Brews-Studio/arra-oracle-v3
```

The command runs the `arra-oracle-v3` bin, which starts the HTTP API. By
default it listens on `http://localhost:47778` and stores data under the normal
Oracle data directory. To avoid an existing local server while testing, set a
custom port and data directory:

```bash
ORACLE_DATA_DIR=$(mktemp -d) ORACLE_PORT=47881 PORT=47881 \
  bunx --bun arra-oracle-v3@github:Soul-Brews-Studio/arra-oracle-v3
```

Verify health from another shell:

```bash
curl -sf http://localhost:47778/api/health
# or, if you set PORT=47881:
curl -sf http://localhost:47881/api/health
```

Expected response includes:

```json
{"status":"ok","server":"arra-oracle-v3","oracle":"connected"}
```

## Channel 2: Docker GHCR images

The `alpha` branch publishes multi-arch GHCR images for both runtime modes:

| Image | Purpose |
| --- | --- |
| `ghcr.io/soul-brews-studio/arra-oracle-v3:http` | HTTP API on container port `47778` |
| `ghcr.io/soul-brews-studio/arra-oracle-v3:stdio` | MCP stdio server for Docker MCP Toolkit / Gateway |

Verify the published tags include both common desktop/server architectures:

```bash
docker buildx imagetools inspect ghcr.io/soul-brews-studio/arra-oracle-v3:http
docker buildx imagetools inspect ghcr.io/soul-brews-studio/arra-oracle-v3:stdio
```

Expected platforms include `linux/amd64` and `linux/arm64`.

Run the HTTP image:

```bash
docker run --rm -p 47778:47778 -v arra-oracle-data:/data \
  ghcr.io/soul-brews-studio/arra-oracle-v3:http
```

Verify health from another shell:

```bash
curl -sf http://localhost:47778/api/health
```

Smoke-test the MCP stdio image with newline-delimited JSON-RPC:

```bash
docker run --rm -i -e ORACLE_LOG_TARGET=stderr -v arra-oracle-data:/data \
  ghcr.io/soul-brews-studio/arra-oracle-v3:stdio <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"arra-smoke","version":"1.0.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
EOF
```

Expected output includes `oracle_search` in the `tools/list` result.

### Build locally instead of pulling GHCR

```bash
docker build -t arra-oracle-v3:http --target http-server .
docker build -t arra-oracle-v3:stdio --target mcp-stdio .
```

## Channel 3: Docker MCP Toolkit install

Use this when you want Docker Desktop MCP Toolkit / Docker MCP Gateway to run
Arra Oracle from the published GHCR stdio image instead of local source. The
repository catalog points at:

```text
ghcr.io/soul-brews-studio/arra-oracle-v3:stdio
```

Run from a clone of `Soul-Brews-Studio/arra-oracle-v3`:

```bash
git clone https://github.com/Soul-Brews-Studio/arra-oracle-v3.git
cd arra-oracle-v3

docker mcp profile create --name arra-oracle \
  --server file://$(pwd)/catalog/arra-oracle.yaml
```

Docker MCP slugifies the profile name, so the profile id printed by the command
is usually `arra_oracle`. Add the server to an existing profile instead with:

```bash
docker mcp profile server add <profile-id> \
  --server file://$(pwd)/catalog/arra-oracle.yaml
```

Verify the profile registered the catalog server:

```bash
docker mcp profile server ls | grep arra-oracle
```

Run a gateway smoke test for that profile:

```bash
{
  printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"arra-gateway-smoke","version":"1.0.0"}}}'
  printf '%s\n' '{"jsonrpc":"2.0","method":"notifications/initialized"}'
  printf '%s\n' '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
  sleep 8
} | docker mcp gateway run --profile arra_oracle
```

Expected output includes `oracle_search` in the gateway `tools/list` result.
Connect a client to the profile with, for example:

```bash
docker mcp client connect claude-desktop --profile arra_oracle
```

Docker Desktop users can also open **MCP Toolkit → Catalog → Import catalog**
and select `catalog/arra-oracle.yaml`; then add the `arra-oracle` server to a
profile. The server stores Oracle data in the Docker volume `arra-oracle-data`
and logs to stderr so stdio remains valid MCP JSON-RPC.

## From source

```bash
git clone https://github.com/Soul-Brews-Studio/arra-oracle-v3.git
cd arra-oracle-v3
bun install
bun run dev      # MCP stdio server
bun run server   # HTTP API on :47778
```

## Index your own knowledge

To index your own `ψ/memory` files:

```bash
ORACLE_REPO_ROOT=/path/to/your/repo bun run index
```

Common scanned paths include:

- `ψ/memory/resonance/*.md`
- `ψ/memory/learnings/*.md`
- `ψ/memory/retrospectives/**/*.md`

## Optional: Vector adapters

Arra Oracle runs with local LanceDB vector storage by default. See
[TONIGHT-SHIPPED.md](./TONIGHT-SHIPPED.md#vector-store-adapters-and-per-collection-config) for Qdrant,
remote vector service, fallback, and read-only mode environment variables.

## Troubleshooting

### Port 47778 is already in use

Use a different host port for Docker:

```bash
docker run --rm -p 47881:47778 -v arra-oracle-data:/data \
  ghcr.io/soul-brews-studio/arra-oracle-v3:http
curl -sf http://localhost:47881/api/health
```

Or set both `ORACLE_PORT` and `PORT` for the Bun remote command:

```bash
ORACLE_PORT=47881 PORT=47881 bunx --bun arra-oracle-v3@github:Soul-Brews-Studio/arra-oracle-v3
```

### MCP stdio output contains logs

Set `ORACLE_LOG_TARGET=stderr` for stdio runs. The GHCR stdio image and catalog
already do this; keep it set for manual `docker run` smoke tests.

### Docker MCP profile id does not match the display name

Use the id printed by `docker mcp profile create`, or list profiles:

```bash
docker mcp profile list
```

## Uninstall

```bash
# Bun/source local data, if you used the default data dir
rm -rf ~/.oracle

# Docker data volume
docker volume rm arra-oracle-data

# Docker MCP profile, if created with --name arra-oracle
docker mcp profile remove arra_oracle
```

---

See also:

- [README.md](./README.md) - Docs index and feature-knob map
- [README.md](../README.md) - Overview
- [TONIGHT-SHIPPED.md](./TONIGHT-SHIPPED.md) - Current alpha operator reference
- [FEDERATION.md](./FEDERATION.md) - Federation pairing, peer search/feed, and security guide
- [API.md](./API.md) - API documentation
- [architecture.md](./architecture.md) - System architecture
