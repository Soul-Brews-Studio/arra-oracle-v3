# Troubleshooting guide

Use this guide when install, startup, MCP, HTTP, vector, plugin, or Docker flows
fail. Start with the quickest health check, then narrow by symptom.

## Quick triage

```bash
open http://localhost:47778/simple
arra-oracle-v3 --help
arra --help
arra health
curl -sf http://localhost:47778/api/health
bunx tsc --noEmit
```

Use Simple Mode first for human verification: it should show **Awake and
remembering** or a specific recovery target for startup, DB, limited search,
plugins, or a down backend. Use `arra health --json` and `curl /api/health`
when you need machine-readable details.

If the HTTP server runs on a non-default port, replace `47778` with that port or
set the CLI target with `arra config add` and `arra config use`.

## Install or PATH issues

Symptoms: `command not found: arra`, `command not found: arra-oracle-v3`, or an
old binary keeps running.

- Reinstall from the pinned tag or branch shown in the release/issue.
- Check Bun's global bin directory with `bun pm bin -g` and ensure it is on
  `PATH`.
- Prefer the short operator binary for day-to-day use: `arra`.
- Use the long binary when debugging package installation: `arra-oracle-v3`.

```bash
bun pm bin -g
bun add -g github:Soul-Brews-Studio/arra-oracle-v3#alpha
arra-oracle-v3 --help
arra --help
```

## Server will not start

Symptoms: port binding errors, `EADDRINUSE`, or the CLI points at a dead server.

- Pick a free port and tell both server and CLI about it.
- Check whether another Arra instance, Docker container, or dev server owns the
  default `47778` port.
- Keep server logs visible during first setup.

```bash
ORACLE_PORT=47881 arra-oracle-v3 serve --port 47881
open http://localhost:47881/simple
arra config add local-47881 http://localhost:47881
arra config use local-47881
curl -sf http://localhost:47881/api/health
```

## HTTP auth returns 401 or 403

Protected `/api/*` routes require a bearer token when `ARRA_API_TOKEN` is set.
Open health/docs/identity routes may still work, which can make auth failures
look like route-specific bugs.

```bash
export ARRA_API_TOKEN='copy-server-token'
curl -H "Authorization: Bearer $ARRA_API_TOKEN" \
  http://localhost:47778/api/stats
```

For tenant-scoped deployments, add the tenant header and optional tenant token:

```bash
curl -H "Authorization: Bearer $ARRA_API_TOKEN" \
  -H 'X-Oracle-Tenant: team-a' \
  -H 'X-Oracle-Tenant-Token: tenant-secret' \
  http://localhost:47778/api/search?q=oracle
```

`X-Tenant-ID` is accepted by legacy middleware, but new docs and clients should
prefer `X-Oracle-Tenant`.

## Empty results in multi-tenant mode

Symptoms: health is green but search, dashboard, traces, or lists show no rows.

- Confirm the request uses the tenant that originally wrote or indexed the data.
- Re-run the same query without tenant headers only against a local development
  server, never against shared deployments.
- Verify import/index jobs wrote to the intended tenant before assuming vector
  search is broken.

## MCP stdio JSON parse errors

Symptoms: the MCP client reports invalid JSON, unexpected log text, or protocol
parse failures.

- Send logs to stderr so stdout remains JSON-RPC only.
- Use embedded mode by leaving `ORACLE_HTTP_URL` unset.
- Use HTTP-proxy mode by setting `ORACLE_HTTP_URL` to a healthy Arra backend.

```json
{
  "env": {
    "ORACLE_LOG_TARGET": "stderr",
    "ORACLE_HTTP_URL": "http://localhost:47778"
  }
}
```

## MCP proxy cannot reach HTTP backend

Symptoms: MCP tools return connection refused, 502, or upstream unavailable.

```bash
curl -sf http://localhost:47778/api/health
ORACLE_HTTP_URL=http://localhost:47778 bun src/index.ts
```

If health fails, fix server startup first. If health passes, verify proxy env is
visible to the MCP process and that `ARRA_API_TOKEN` matches the server when auth
is enabled.

## Vector search is unavailable or empty

Symptoms: `/api/vector/health` is degraded/down, semantic results are empty, or a
vector sidecar proxy returns 502/503.

- Check `/api/vector/health` and `/api/vector/config`.
- Use FTS/search routes while vector adapters are offline.
- Re-run indexing after imports, adapter switches, or collection config changes.
- Confirm vector sidecar env such as `VECTOR_URL`, `VECTOR_DB_URL`, `QDRANT_URL`,
  or `ORACLE_VECTOR_DB` matches the selected adapter.

```bash
curl -sf http://localhost:47778/api/vector/health
curl -sf http://localhost:47778/api/vector/config
curl 'http://localhost:47778/api/search?q=oracle&mode=fts&limit=5'
```

## Plugin or menu entry is missing

- Confirm the plugin has a valid `plugin.json` manifest.
- Restart or reload after adding a plugin directory.
- Check both plugin and menu surfaces.
- If the plugin exposes a sidecar server, verify its health endpoint.

```bash
curl -sf http://localhost:47778/api/plugins
curl -sf http://localhost:47778/api/menu
curl -sf http://localhost:47778/api/mcp/tools
```

## Docker data or port issues

- Mount a persistent data volume so indexes and config survive container
  restarts.
- Publish the HTTP port you actually configured.
- Keep `ORACLE_LOG_TARGET=stderr` for stdio-style containers.
- Pass `ARRA_API_TOKEN` and tenant env explicitly instead of relying on your
  shell environment.

## What to include in a bug report

Include enough detail to reproduce without secrets:

- OS, Bun version, install command, and package tag/commit.
- Server command, selected port, Docker image tag if used.
- Sanitized environment keys, especially auth, tenant, MCP, and vector knobs.
- Exact request/CLI command plus status code and response body.
- Relevant server logs with tokens redacted.
- Whether the same operation works through `/api/docs`, CLI, MCP, or curl.
