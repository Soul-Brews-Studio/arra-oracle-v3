# Modular Backend Current State (#2227)

This maps the current code state for the #2227 modular backend target: Cloudflare
Workers stay thin, the backend runs from the ARRA maw plugin, vector storage can
move behind a separate process, and MCP tools become pluggable.

## Current runtime shape

```text
CF Workers / browsers
  -> HTTP backend: src/server.ts (Elysia)
     -> built-in routes under src/routes/*
     -> unified plugin routes/tools/menus/servers
     -> vector factory/adapters
     -> MCP stdio server or /api/mcp/tools catalog
```

`src/server.ts` is still the backend process entrypoint. It loads unified
plugins, starts plugin sidecar servers, mounts plugin routes, exposes plugin MCP
tool metadata, seeds plugin menu items, and shuts down plugin/vector/db resources
through the graceful shutdown lifecycle.

## ARRA maw plugin

Current implementation:

- Manifest: `src/plugins/arra/plugin.json`
- Handler: `src/plugins/arra/index.ts`
- Serve command: `src/plugins/arra/serve-cli.ts`
- Legacy/package plugin surface: `maw-plugin/*`

Capabilities present:

- The `arra` manifest exposes CLI, menu, and API surfaces.
- Verbs include `help`, `version`, `menu`, `status`, `commands`, `health`,
  `vector-config`, and `serve`.
- `arraCli()` dispatches `serve` to `serveCli()`.
- `serveCli()` starts the backend with `bun run server`, sets `PORT` and
  `ORACLE_PORT`, writes PID metadata via `src/process-manager`, and supports
  `start`, `status`, and `stop`.
- Prior #2227 smoke verification proved `serveCli()` can start the backend and
  get HTTP 200 from `/api/health`.

Gaps:

- The external installed `maw` command used in the previous verification did not
  expose `maw arra`; install/discovery wiring is still needed outside this repo.
- Backend startup is plugin-triggered, but the backend process remains
  `bun run server`, not a pure plugin-owned server manifest.

## Unified plugin loader

Current implementation:

- Loader: `src/plugins/unified-loader.ts`
- Manifest schema: `src/plugins/unified-manifest.ts`
- Plugin dirs: `src/plugins/plugin-dirs.ts`
- Sidecar server support: `src/plugins/unified-server.ts`
- Registry projection: `src/plugins/registry.ts`

Capabilities present:

- Discovers `plugin.json` from cwd `.maw/plugins`, `MAW_PLUGINS_DIR`, user plugin
  dirs, and server-provided extra dirs such as `src/plugins`.
- Normalizes surfaces for `mcpTools`, `apiRoutes`, `proxy`, `server`, `menu`,
  `cliSubcommands`, and `exportFormats`.
- Sorts plugins by dependencies and invokes handlers with an `InvokeContext`.
- Mounts plugin API routes into Elysia.
- Adapts plugin MCP tools into the runtime tool registry.
- Starts sidecar plugin servers from `server.command` manifests, allocates a
  localhost port, health-checks them, and proxies `/api/plugins/:name/server/*`.
- Tracks plugin status and lifecycle init/destroy failures as degraded instead
  of crashing the backend.

Gaps:

- The loader is repo/backend-facing; external maw CLI installation must still
  discover or install the ARRA plugin package.
- Sidecar `server` plugins exist, but ARRA itself is not expressed as a sidecar
  server manifest yet.

## Vector factory and vector process boundary

Current implementation:

- Factory: `src/vector/factory.ts`
- Config: `src/vector/config.ts`, `src/vector/config-models.ts`
- Proxy protocol: `src/vector/proxy-protocol.ts`
- Proxy contract resolver: `src/vector/proxy-contract.ts`
- Proxy adapter: `src/vector/adapters/proxy.ts`
- Proxy route manifest bridge: `src/vector/proxy-manifest.ts`
- Service registry: `src/vector/service-registry.ts`

Capabilities present:

- `createVectorStore()` supports `lancedb`, `sqlite-vec`, `qdrant`,
  `cloudflare-vectorize`, `proxy`, `turbovec`, and legacy `chroma` fallback.
- `getEmbeddingModels()` reads `vector-server.json` when present, otherwise uses
  default bge-m3/nomic/qwen3 LanceDB collections.
- `configToModels()` can route a collection to a proxy service endpoint through
  `storage.services[*].type = "proxy"`.
- `resolveVectorProxyContract()` resolves explicit endpoints,
  `ORACLE_PROXY_VECTOR_URL`, fallback `VECTOR_DB_URL`, and
  `ORACLE_PROXY_VECTOR_TIMEOUT_MS`.
- `ProxyVectorAdapter` implements the standard proxy protocol:
  `POST /vectors/add`, `POST /vectors/query`, `GET /vectors/stats`,
  `DELETE /vectors/collection`, and `GET /health`.
- Tenant IDs flow to proxy vector requests through tenant headers.
- `proxyVectorSidecarRequest()` can expose vector sidecar proxy routes from the
  same manifest shape used by unified proxy routes.

Gaps:

- The default backend mode is still local LanceDB unless config/env selects a
  proxy adapter.
- Separate vector server process orchestration is present as config/protocol
  contracts, but end-to-end backend -> vector-server deployment is not the
  default happy path yet.

## MCP state

Current implementation:

- Stdio MCP server: `src/mcp/server.ts`
- Plugin tool adapter: `src/mcp/plugin-tools.ts`
- HTTP proxy mode: `src/mcp/http-proxy.ts`
- Tenant mapping: `src/mcp/tenant.ts`
- Browser-facing catalog: `src/routes/mcp/tools.ts`

Capabilities present:

- MCP can run embedded, initializing DB + vector store directly.
- MCP can run in HTTP-proxy mode when `ORACLE_HTTP_URL`, `ORACLE_API`, or
  `NEO_ARRA_API` is set.
- Core tools and plugin MCP tools are merged into one registry.
- Plugin MCP tools are filtered to avoid core-name collisions, converted to MCP
  tool responses, and respect read-only/tool-group filtering.
- `/api/mcp/tools` lists core and plugin tool definitions for browser/frontends.
- Tenant IDs can be passed through MCP arguments and forwarded as headers when
  proxying to the HTTP backend.

Gaps:

- MCP tool plug-in/out is supported by unified-loader manifests, but user-facing
  install/remove UX is still separate from this backend map.
- HTTP-proxy mode maps known core tools to REST paths; arbitrary plugin tool
  proxying over HTTP still depends on plugin MCP registration/runtime wiring.

## Overall readiness

Ready today:

- Backend can be started by the in-repo ARRA plugin serve implementation.
- Backend loads unified plugins and projects API/menu/MCP/server surfaces.
- Vector factory supports local engines and a proxy protocol for separate vector
  services.
- MCP supports embedded mode, HTTP-proxy mode, and plugin MCP tool registration.

Main gaps for #2227 acceptance:

1. External `maw arra serve` install/discovery wiring.
2. ARRA backend process represented as an installable maw plugin package, not
   only repo-local `src/plugins/arra` plus `bun run server`.
3. Default vector-server deployment path and smoke test for backend -> separate
   vector server.
4. End-to-end Workers -> backend -> vector DB verification.
5. Clear UX for adding/removing MCP tool plugins without touching core code.
