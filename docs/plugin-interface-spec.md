# Plugin Interface Spec — Multi-Language Plugins

Arra Oracle V3 plugins can be written in **any language**. Three integration modes:

## Plugin Manifest (`plugin.json`)

Every plugin lives in a directory under `~/.oracle/plugins/<name>/` (or paths in `ORACLE_PLUGIN_DIRS` env, comma-separated). Each must have a `plugin.json`:

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "What this plugin does",
  "type": "js | http | ffi | subprocess",
  "enabled": true
}
```

Type-specific fields below.

## Mode 1: JS Plugin (current, backward-compatible)

```json
{ "type": "js", "main": "index.ts" }
```

- Loaded via `import()` at startup
- Exports: `{ surfaces, menu, apiRoutes, cliSubcommands, mcpTools }`
- Runs in-process (same Bun runtime)

## Mode 2: HTTP Sidecar (any language)

```json
{
  "type": "http",
  "port": 9001,
  "healthPath": "/health",
  "routes": [
    { "prefix": "/api/plugins/my-plugin", "methods": ["GET", "POST"] }
  ],
  "startup": { "command": "./my-server", "args": ["--port", "9001"] }
}
```

**Lifecycle:**
1. Oracle reads manifest, optionally spawns `startup.command`
2. Health-check: `GET http://localhost:{port}{healthPath}` — must return 2xx within 10s
3. Route proxy: requests matching `routes[].prefix` forwarded to `http://localhost:{port}{path}`
4. Periodic health poll (30s default, configurable via `healthInterval`)
5. On health fail: mark degraded, retry 3x, then disable
6. On Oracle shutdown: send `DELETE /shutdown` (best-effort), then SIGTERM the child

**Plugin implements:** any HTTP server. Oracle proxies transparently — headers, body, status preserved. CORS handled by Oracle (plugin doesn't need CORS).

**Example (Rust with Axum):**
```rust
#[tokio::main]
async fn main() {
    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/api/plugins/vectorx/search", post(vector_search));
    axum::serve(listener, app).await.unwrap();
}
```

## Mode 3: FFI (Rust/Zig/C — fastest)

```json
{
  "type": "ffi",
  "library": "libvectorx.dylib",
  "interface": "vector | compute | custom",
  "symbols": {
    "query": { "args": ["ptr", "i32", "i32", "ptr", "i32"], "returns": "i32" },
    "add_documents": { "args": ["ptr", "i32"], "returns": "i32" },
    "get_stats": { "args": ["ptr", "i32"], "returns": "i32" }
  }
}
```

**C ABI contract (all modes return JSON via output buffer):**
```c
// Vector adapter interface
int plugin_query(const char* query_json, int query_len, char* result_json, int result_len);
int plugin_query_by_id(const char* id, int id_len, int n_results, char* result_json, int result_len);
int plugin_query_by_vector(const float* vector, int dims, int n_results, char* result_json, int result_len);
int plugin_add_documents(const char* docs_json, int docs_len);
int plugin_get_stats(char* result_json, int result_len);
int plugin_init(const char* config_json, int config_len);
void plugin_shutdown(void);
```

**Return convention:** functions return bytes written to result buffer (>0 = success), or negative error code. Result is always JSON matching `VectorQueryResult` or `{ count: number }`.

**Loaded via:** `bun:ffi` `dlopen()` at startup. Oracle wraps FFI calls into `VectorStoreAdapter` interface transparently.

## Mode 4: Subprocess / MCP (any language)

```json
{
  "type": "subprocess",
  "command": "./my-mcp-server",
  "args": ["--stdio"],
  "env": { "MY_CONFIG": "value" },
  "tools": "auto"
}
```

**Protocol:** JSON-RPC over stdin/stdout (MCP standard).

**Lifecycle:**
1. Oracle spawns child process
2. Sends `initialize` → child responds with capabilities
3. Sends `tools/list` → registers returned tools in Oracle's tool registry
4. On tool call: `tools/call` → forward to child, return result
5. On crash: restart with exponential backoff (1s, 2s, 4s, max 30s), max 5 retries
6. On Oracle shutdown: send `shutdown` notification, wait 5s, SIGTERM

**Plugin implements:** any binary that speaks MCP stdio. Existing reference: `oracle_mcp_call` / `oracle_mcp_list_tools`.

## Discovery

On startup, Oracle scans:
1. `~/.oracle/plugins/*/plugin.json`
2. Directories in `ORACLE_PLUGIN_DIRS` env (comma-separated)
3. For each valid manifest: load by type

Order: JS plugins first (in-process), then subprocess (spawn), then HTTP (proxy), then FFI (dlopen). Plugins with `enabled: false` are skipped.

## Error Handling

| Situation | Behavior |
|-----------|----------|
| Manifest parse error | Log warning, skip plugin |
| Health check fail (HTTP) | Retry 3x at 5s interval, then disable |
| Child crash (subprocess) | Restart with backoff, max 5 retries |
| FFI load fail | Log error with dlopen message, skip |
| Plugin timeout (>30s) | Cancel request, return 504 to caller |
| Plugin returns invalid JSON | Return 502 with plugin name in error |

## Security

- HTTP sidecars bind to localhost only — Oracle never proxies to remote hosts
- FFI plugins run in-process (same trust as Oracle itself) — only load trusted libraries
- Subprocess plugins inherit Oracle's env by default; use `env` field to restrict
- Plugin routes are namespaced: `/api/plugins/<name>/...` — can't shadow core routes
