# Tonight's shipped reference — config, plugins, federation, Docker/GHCR

This is the compact operator map for the large 2026-06-06/07 alpha wave. It is meant to answer: *what shipped, where is the code, what knob controls it, and what is the first command to try?*

See [README.md](./README.md) for the docs index that links every guide in this wave.

## Quick index

| Surface | Status | Primary knobs | First command |
| --- | --- | --- | --- |
| MCP embedded vs HTTP-proxy | `alpha` | `ORACLE_HTTP_URL`, `ORACLE_API`, `NEO_ARRA_API` | `ORACLE_HTTP_URL=http://localhost:47778 bun src/index.ts` |
| MCP tool/plugin toggles | `alpha` | `arra.config.json`, `plugins.json`, `$ORACLE_DATA_DIR/config.json` | `arra doctor --json` |
| Operator CLI targets | `alpha` | `ORACLE_API`, `--at`, `.arra/config.json`, XDG config | `arra config` |
| Vector adapter selection | `alpha` | `ORACLE_VECTOR_DB`, `ORACLE_VECTOR_DB_PATH`, `QDRANT_URL`, `VECTOR_URL` | `ORACLE_VECTOR_DB=qdrant QDRANT_URL=http://localhost:6333 bun run server` |
| Docker/GHCR | `alpha` | Docker targets `http-server`, `mcp-stdio` | `docker run --rm -p 47778:47778 ghcr.io/soul-brews-studio/arra-oracle-v3:http` |
| Docker MCP Toolkit catalog | `alpha` | `catalog/arra-oracle.yaml` | `docker mcp profile create --server file://$(pwd)/catalog/arra-oracle.yaml` |
| Federation / peer identity | shipped on `alpha` | `ARRA_SCOUT_ANNOUNCE`, `ARRA_PEER_TOKEN`, `ARRA_NAMED_PEERS` | see [FEDERATION.md](./FEDERATION.md) |

## MCP modes: embedded vs HTTP-proxy

**What shipped:** the MCP stdio server can either open the database/vector stack directly (**embedded**) or proxy supported MCP tool calls to a long-running HTTP server (**HTTP-proxy**). HTTP-proxy is the safer fleet mode when multiple stdio clients would otherwise contend on SQLite/LanceDB.

- **Code:** [`src/index.ts`](../src/index.ts), proxy tests under [`src/tools/__tests__/mcp-proxy-fallback.test.ts`](../src/tools/__tests__/mcp-proxy-fallback.test.ts)
- **Default:** embedded mode when no proxy env is set.
- **Proxy env priority:** `ORACLE_HTTP_URL` first, then `ORACLE_API`, then legacy `NEO_ARRA_API`.

```bash
# Embedded stdio MCP: direct DB/vector access.
bun src/index.ts

# HTTP-proxy stdio MCP: one HTTP server owns DB/vector writes.
bun run server
ORACLE_HTTP_URL=http://localhost:47778 bun src/index.ts
```

Use embedded mode for single-user local MCP. Use HTTP-proxy mode for Codex/Claude fleets, Docker MCP Gateway, or any situation with many transient stdio MCP processes.

## MCP tool/plugin toggles

**What shipped:** MCP tools are grouped into plugin-like entries with tiers and weights, while preserving the legacy flat toggles. Operators can disable whole groups/plugins or individual tools without editing code.

- **Code:** [`src/config/tool-groups.ts`](../src/config/tool-groups.ts), MCP registration in [`src/index.ts`](../src/index.ts)
- **Config files, in priority order:**
  1. repo-local `arra.config.json`
  2. repo-local `plugins.json`
  3. `$ORACLE_DATA_DIR/config.json`
  4. `$ORACLE_DATA_DIR/plugins.json`
  5. default: all tools enabled
- **Plugin tiers:** `core`, `standard`, `extra`
- **Ordering:** lower `weight` advertises first.
- **Alias compatibility:** `arra_*` and `muninn_*` normalize to canonical `oracle_*` names for toggles.

Example `arra.config.json`:

```json
{
  "plugins": [
    { "name": "search", "enabled": true, "tier": "core", "weight": 10 },
    { "name": "dig", "enabled": false, "tier": "standard", "weight": 60 }
  ],
  "disabled_tools": ["oracle_thread"],
  "enabled_tools": ["muninn_trace_get"]
}
```

Legacy flat group toggles still work:

```json
{
  "tools": {
    "search": true,
    "knowledge": true,
    "session": false,
    "forum": false,
    "trace": true,
    "standalone": true
  }
}
```

Current built-in MCP plugin map:

| Plugin | Tier | Tools |
| --- | --- | --- |
| `guide` | `core` | `____IMPORTANT` |
| `search` | `core` | `oracle_search`, `oracle_read`, `oracle_list`, `oracle_concepts` |
| `knowledge` | `core` | `oracle_learn`, `oracle_stats`, `oracle_supersede` |
| `session` | `standard` | `oracle_handoff`, `oracle_inbox` |
| `forum` | `standard` | `oracle_thread`, `oracle_threads`, `oracle_thread_read`, `oracle_thread_update` |
| `trace` | `standard` | `oracle_trace` |
| `dig` | `standard` | `oracle_trace_list`, `oracle_trace_get`, `oracle_trace_link`, `oracle_trace_unlink`, `oracle_trace_chain` |
| `standalone` | `extra` | `oracle_reflect`, `oracle_verify` |

## Operator CLI: `arra`, targets, config, doctor, plugins

**What shipped:** `arra` is the short operator bin alias for `arra-cli`, with layered target resolution and diagnostics.

- **Code:** [`cli/src/cli.ts`](../cli/src/cli.ts), [`cli/src/lib/config.ts`](../cli/src/lib/config.ts), [`cli/src/commands/config.ts`](../cli/src/commands/config.ts), [`cli/src/commands/doctor.ts`](../cli/src/commands/doctor.ts)
- **Bin map:** see [`package.json`](../package.json) (`arra`, `arra-cli`, `arra-oracle-v3`, `arra-oracle-v2`).
- **Target resolution order:**
  1. `ORACLE_API=http://host:47778`
  2. one-off `arra --at <name> <command>`
  3. nearest project `.arra/config.json`
  4. global `$XDG_CONFIG_HOME/arra/config.json` or `~/.config/arra/config.json`
  5. legacy `NEO_ARRA_API`
  6. `http://localhost:47778`

```json
{
  "default": "local",
  "targets": {
    "local": "http://localhost:47778",
    "m5": "http://m5.local:47778"
  }
}
```

```bash
arra config                 # show resolved target and config sources
arra config path            # print global config path
arra use m5                 # set global default target
arra --at local health      # one-shot target override
arra doctor                 # diagnose server/API/DB/vector/config/MCP mode
arra doctor --json          # machine-readable diagnostics
```

CLI plugin commands are also available:

```bash
arra plugin list
arra plugin info <name>
arra plugin install <url-or-path>
arra plugin remove <name>
```

CLI plugin manifests live under [`cli/src/plugins/*/plugin.json`](../cli/src/plugins). Loader/registry code lives under [`cli/src/plugin/`](../cli/src/plugin/).

## Vector store adapters and per-collection config

**What shipped:** vector search is adapter-backed. LanceDB remains the default local adapter; Qdrant is opt-in; vector routes can also be proxied through a separate vector service.

- **Code:** [`src/vector/factory.ts`](../src/vector/factory.ts), [`src/vector/config.ts`](../src/vector/config.ts), adapters under [`src/vector/adapters/`](../src/vector/adapters), proxy routing in [`src/server/vector-proxy.ts`](../src/server/vector-proxy.ts)
- **Default:** LanceDB under `$ORACLE_DATA_DIR/lancedb`
- **Adapter env:**
  - `ORACLE_VECTOR_DB=lancedb|qdrant|sqlite-vec|chroma|cloudflare-vectorize`
  - `ORACLE_VECTOR_DB_PATH=/path/to/vector-store`
  - `QDRANT_URL=http://localhost:6333`
  - `QDRANT_API_KEY=...`
- **Vector sidecar/proxy env:**
  - `VECTOR_URL=http://localhost:<port>` proxies vector routes to a separate service
  - `VECTOR_FALLBACK=fts5` keeps FTS5 available when the vector proxy is unreachable
  - `ORACLE_VECTOR_READONLY=1` makes vector sidecar DB access read-only
  - `VECTOR_PORT=<port>` controls `src/vector-server.ts`

Examples:

```bash
# Default local LanceDB.
bun run server

# Qdrant-backed vectors.
docker run -p 6333:6333 qdrant/qdrant
ORACLE_VECTOR_DB=qdrant QDRANT_URL=http://localhost:6333 bun run server

# Split vector service from HTTP server.
ORACLE_VECTOR_READONLY=1 VECTOR_PORT=47878 bun src/vector-server.ts
VECTOR_URL=http://localhost:47878 bun run server
```

Per-collection adapter config is read from the vector config file managed by [`src/vector/config.ts`](../src/vector/config.ts). Keep collection-level adapter choices explicit when mixing local LanceDB and remote Qdrant.

## Docker, GHCR, Compose, and Docker MCP Toolkit

**What shipped:** the repo has a multi-target Dockerfile, Compose HTTP smoke path, GHCR publishing on `alpha`, and a Docker MCP Toolkit catalog that points at the real published stdio image.

- **Code:** [`Dockerfile`](../Dockerfile), [`docker-compose.yml`](../docker-compose.yml), [`.github/workflows/docker-publish.yml`](../.github/workflows/docker-publish.yml), [`catalog/arra-oracle.yaml`](../catalog/arra-oracle.yaml)
- **Published images:**
  - `ghcr.io/soul-brews-studio/arra-oracle-v3:http`
  - `ghcr.io/soul-brews-studio/arra-oracle-v3:http-alpha`
  - `ghcr.io/soul-brews-studio/arra-oracle-v3:stdio`
  - `ghcr.io/soul-brews-studio/arra-oracle-v3:stdio-alpha`
- **Platforms:** `linux/amd64` and `linux/arm64`

```bash
# Local builds.
docker build --target http-server -t arra-oracle-v3:http .
docker build --target mcp-stdio -t arra-oracle-v3:stdio .

# Published HTTP image.
docker run --rm -p 47778:47778 -v arra-data:/data ghcr.io/soul-brews-studio/arra-oracle-v3:http
curl -sf http://localhost:47778/api/health

# Compose HTTP path.
docker compose up -d
curl -sf http://localhost:47778/api/health

# Docker MCP Toolkit catalog.
mkdir -p ~/.docker/mcp/catalogs
cp catalog/arra-oracle.yaml ~/.docker/mcp/catalogs/
```

The catalog image is `ghcr.io/soul-brews-studio/arra-oracle-v3:stdio`, so click-to-install flows do not need a local build once GHCR publishing has run.

## Federation / peer identity

Federation is now mounted in the `alpha` source tree. Use the full operator
guide in [FEDERATION.md](./FEDERATION.md) for pairing, Scout discovery,
TOFU pinning, peer feed/search, and the Arra↔mawjs worked example.

| Feature | Source path | Knob / endpoint |
| --- | --- | --- |
| Maw peer info | `src/routes/peer/info.ts` | `GET /info` |
| Stable identity | `src/routes/peer/identity.ts`, `src/peer/identity-key.ts` | `GET /api/identity`, `$ORACLE_DATA_DIR/peer-key.hex` |
| Named peer probing | `src/routes/peer/peers.ts`, `src/peer/peer-query.ts` | `GET /api/peers`, `arra peers --token <token>` |
| Peer feed | `src/routes/peer/feed.ts` | `GET /api/peer/feed` (**not** `/api/feed`) |
| Peer search | `src/routes/peer/search.ts` | `POST /api/peer/search` |
| Static peer config | `src/peer/peer-registry.ts` | `ARRA_NAMED_PEERS`, `$ORACLE_DATA_DIR/peers.json`, `ARRA_PEERS_CONFIG` |
| TOFU trust store | `src/peer/peer-tofu.ts` | `$ORACLE_DATA_DIR/peers-tofu.json`, `ARRA_PEERS_TOFU_PATH` |
| Peer auth | `src/peer/peer-auth.ts` | `ARRA_PEER_TOKEN` bearer auth or `?token=` for feed/search |
| Scout HELLO multicast | `src/peer/scout-announcer.ts` | `ARRA_SCOUT_ANNOUNCE=1` |

Quick smoke:

```bash
ARRA_SCOUT_ANNOUNCE=1 \
ARRA_PEER_TOKEN=<shared-token> \
bun run server

curl http://localhost:47778/info
curl http://localhost:47778/api/identity
curl 'http://localhost:47778/api/peer/feed?token=<shared-token>&limit=20'
curl -X POST http://localhost:47778/api/peer/search \
  -H 'content-type: application/json' \
  -H 'Authorization: Bearer <shared-token>' \
  -d '{"query":"federation","limit":5}'
```

Treat first-seen peer keys as TOFU pins: verify unexpected key changes
out-of-band before trusting search/feed results from that peer.

## Verification checklist for this wave

```bash
bun install --frozen-lockfile
bun run build
docker build --target http-server -t arra-oracle-v3:http-test .
docker build --target mcp-stdio -t arra-oracle-v3:stdio-test .
docker compose up -d --build
curl -sf http://localhost:47778/api/health
docker buildx imagetools inspect ghcr.io/soul-brews-studio/arra-oracle-v3:stdio
```

For MCP stdio smoke on this repo's SDK transport, send newline-delimited JSON-RPC (not `Content-Length` frames) and verify `tools/list` includes `oracle_search`.
