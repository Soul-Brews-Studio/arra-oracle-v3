# Docker MCP Toolkit

Arra ships three Docker targets:

| Target | Image tag | Purpose |
|---|---|---|
| `http-server` | `ghcr.io/soul-brews-studio/arra-oracle-v3:http` / `:latest` | Long-running HTTP writer on port `47778` |
| `mcp-stdio` | `ghcr.io/soul-brews-studio/arra-oracle-v3:stdio` | Stdio MCP server for Docker MCP Toolkit / Gateway |
| `vector-server` | `ghcr.io/soul-brews-studio/arra-oracle-v3:vector` | Standalone vector sidecar for `VECTOR_URL` on port `47779` |

The stdio target sets `ORACLE_LOG_TARGET=stderr` so JSON-RPC stays clean on stdout.

## Local smoke tests

```bash
# HTTP server target (default)
docker build -t arra-oracle-v3:http --target http-server .
docker run --rm -p 47902:47778 -v arra-oracle-data:/data arra-oracle-v3:http
curl -fsS http://localhost:47902/api/health

# MCP stdio target
docker build -t arra-oracle-v3:stdio --target mcp-stdio .
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  | docker run -i --rm -v arra-oracle-data:/data arra-oracle-v3:stdio

# Vector sidecar target
docker build -t arra-oracle-v3:vector --target vector-server .
docker run --rm -p 47903:47779 -v arra-oracle-data:/data arra-oracle-v3:vector
curl -fsS http://localhost:47903/api/vector/health
```

## Standalone vector sidecar profile

Use the `vector` compose profile when you want core HTTP/FTS5 in one process and vector operations in another process. Set `VECTOR_URL=http://vector:47779` when enabling the profile; Compose starts the normal `arra` core plus the `vector` sidecar target.

```bash
VECTOR_URL=http://vector:47779 docker compose --profile vector up -d
curl -fsS http://localhost:47778/api/health | jq .vectorMode   # proxied
curl -fsS 'http://localhost:47778/api/search?q=oracle&mode=hybrid' | jq .vectorAvailable
```

FTS5 remains local to the core server. If the vector sidecar is unavailable, hybrid search returns local FTS5 results with `vectorAvailable: false`.

## Docker MCP Gateway (stdio clients)

The repo includes a custom Docker MCP catalog at [`catalog/arra-oracle.yaml`](../catalog/arra-oracle.yaml). For a local Gateway run:

```bash
mkdir -p ~/.docker/mcp/catalogs
cp catalog/arra-oracle.yaml ~/.docker/mcp/catalogs/arra-oracle.yaml

docker mcp gateway run \
  --catalog arra-oracle.yaml \
  --servers arra-oracle \
  --transport stdio
```

For local development before GHCR/package visibility is available, build the stdio image locally and change the catalog `image:` field to `arra-oracle-v3:stdio`.

```bash
docker build --target mcp-stdio -t arra-oracle-v3:stdio .
perl -0pi -e 's#ghcr.io/soul-brews-studio/arra-oracle-v3:stdio#arra-oracle-v3:stdio#' \
  ~/.docker/mcp/catalogs/arra-oracle.yaml
```

## n8n / SSE Gateway recipe

n8n talks to HTTP/SSE endpoints, not stdio. Run Docker MCP Gateway with SSE transport and point n8n's MCP node at the Gateway URL.

```bash
# Terminal 1: start the Gateway on a non-conflicting port.
MCP_GATEWAY_AUTH_TOKEN="$(openssl rand -hex 24)"
export MCP_GATEWAY_AUTH_TOKEN

docker mcp gateway run \
  --catalog ~/.docker/mcp/catalogs/arra-oracle.yaml \
  --servers arra-oracle \
  --transport sse \
  --port 8811 \
  --long-lived
```

Then in n8n:

1. Add an MCP Client node.
2. Transport: SSE.
3. Server URL: `http://localhost:8811/sse`.
4. Header: `Authorization: Bearer $MCP_GATEWAY_AUTH_TOKEN`.
5. Enable the `oracle_*` tools you want to expose to the workflow.

Use `--long-lived` for n8n so the Gateway does not pay container cold-start cost on every workflow step. Arra persists state in the `arra-oracle-data:/data` Docker volume.

## Optional semantic embeddings

Arra works without Ollama via SQLite FTS5. To enable vector embeddings, make Ollama reachable from the container and set `OLLAMA_BASE_URL` in the catalog.

Typical host Ollama value:

```yaml
env:
  - name: OLLAMA_BASE_URL
    value: "http://host.docker.internal:11434"
```

## HTTP writer mode

For fleet-style single-writer operation, run the HTTP image separately and point the stdio container at it:

```bash
docker run -d --name arra-http \
  -p 47778:47778 \
  -v arra-oracle-data:/data \
  ghcr.io/soul-brews-studio/arra-oracle-v3:http
```

Then set this in the catalog env block:

```yaml
- name: ORACLE_API
  value: "http://host.docker.internal:47778"
```

If `ORACLE_API=embedded`, the stdio container opens `/data/oracle.db` directly. That is fine for Docker MCP Toolkit's single-container usage; use HTTP writer mode when multiple MCP processes share the same SQLite database.
