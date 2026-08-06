# Plugin quickstart for Oracle developers

Use this when you want a small plugin running locally before you package it. This
quickstart follows the current unified runtime used by `src/server.ts`, while the
cross-language contract remains documented in
[plugin-interface-spec.md](./plugin-interface-spec.md) and
[`src/plugins/types.ts`](../src/plugins/types.ts).

## 0. Pick a mode

- **JS in-process**: best for API, MCP, CLI, menu, or export-format extensions
  that can run inside Oracle's Bun process.
- **HTTP sidecar**: best when the plugin owns its own process or language
  runtime. Oracle starts it, checks health, and proxies requests under
  `/api/plugins/<name>/server/*`.

For FFI and subprocess/MCP shapes, use `docs/plugin-interface-spec.md` after this
quickstart.

## 1. Plugin directory

During development, put a plugin folder in any scanned directory:

```bash
mkdir -p .maw/plugins/hello-oracle
cd .maw/plugins/hello-oracle
```

The unified runtime scans `.maw/plugins` in the current directory and parents,
then `$MAW_PLUGINS_DIR`, `~/.maw/plugins`, `~/.arra/plugins`, and
`~/.oracle/plugins`. The lower-level `PluginManifest` loader in
`src/plugins/types.ts` also supports `~/.oracle/plugins` and comma-separated
`ORACLE_PLUGIN_DIRS`.

## 2. JS in-process plugin example

Create `plugin.json`:

```json
{
  "name": "hello-oracle",
  "version": "1.0.0",
  "entry": "./index.ts",
  "description": "Tiny in-process Oracle plugin",
  "apiRoutes": [
    { "path": "/api/plugins/hello-oracle", "methods": ["GET"], "handler": "api" }
  ],
  "mcpTools": [
    {
      "name": "oracle_hello",
      "description": "Return a hello payload",
      "inputSchema": { "type": "object", "properties": { "name": { "type": "string" } } },
      "handler": "tool",
      "readOnly": true
    }
  ],
  "menu": [
    { "label": "Hello Oracle", "path": "/plugins/hello-oracle", "group": "tools" }
  ]
}
```

Create `index.ts`:

```ts
type PluginContext = {
  source: 'api' | 'mcp' | 'cli' | 'server';
  plugin: string;
  query?: Record<string, unknown>;
  args?: unknown[];
};

export function api(ctx: PluginContext) {
  const name = typeof ctx.query?.name === 'string' ? ctx.query.name : 'operator';
  return { ok: true, body: { plugin: ctx.plugin, message: `hello ${name}` } };
}

export function tool(ctx: PluginContext) {
  const input = ctx.args?.[0] as { name?: string } | undefined;
  return { ok: true, body: { message: `hello ${input?.name ?? 'agent'}` } };
}
```

## 3. HTTP sidecar plugin example

Use a sidecar when the plugin should run as a separate HTTP process. Oracle
allocates a local port and passes it as both `ARRA_PLUGIN_PORT` and `PORT`.

Create `plugin.json`:

```json
{
  "name": "hello-sidecar",
  "version": "1.0.0",
  "entry": "./index.ts",
  "description": "HTTP sidecar plugin",
  "server": {
    "command": "bun",
    "args": ["server.ts"],
    "healthPath": "/health",
    "autostart": true,
    "env": { "PLUGIN_MESSAGE": "pong" }
  }
}
```

Create `index.ts` for loader metadata:

```ts
export function noop() {
  return { ok: true };
}
```

Create `server.ts`:

```ts
const port = Number(process.env.ARRA_PLUGIN_PORT || process.env.PORT);

const server = Bun.serve({
  hostname: '127.0.0.1',
  port,
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return Response.json({ ok: true, port });
    if (url.pathname === '/echo') {
      return Response.json({
        plugin: request.headers.get('x-arra-plugin-name'),
        message: process.env.PLUGIN_MESSAGE,
        q: url.searchParams.get('q'),
      });
    }
    return Response.json({ error: 'not found' }, { status: 404 });
  },
});

process.on('SIGTERM', () => {
  server.stop(true);
  process.exit(0);
});
```

Call it through Oracle:

```bash
curl -sf http://localhost:47778/api/plugins/hello-sidecar/server/health
curl -sf 'http://localhost:47778/api/plugins/hello-sidecar/server/echo?q=ok'
```

If you wire directly against the lower-level interface from `src/plugins/types.ts`,
the equivalent sidecar manifest uses `type: "http"`, `port`, `healthPath`,
`routes[]`, and optional `startup`. Keep routes under `/api/plugins/<name>/...`.

## 4. Manifest format checklist

Unified runtime fields used above:

| Field | Required | Notes |
| --- | --- | --- |
| `name` | yes | Lowercase slug: `^[a-z0-9-]+$`. |
| `version` | yes | Semver prefix such as `1.0.0`. |
| `entry` | yes | Relative module inside the plugin directory. |
| `enabled` | no | `false` skips registration. |
| `apiRoutes[]` | no | In-process handlers exported by `entry`. |
| `mcpTools[]` | no | Tool metadata plus handler name. |
| `menu[]` | no | Studio navigation metadata. |
| `cliSubcommands[]` | no | CLI command metadata plus handler name. |
| `server` | no | Sidecar command, args, env, health path, autostart. |
| `proxy[]` | no | Proxy to a configured target env URL. |

`src/plugins/types.ts` defines the lower-level multi-language manifest as common
`name`, `version`, `description?`, `type`, `enabled?` plus one type-specific
branch: `js.main`, `http.port/routes/startup`, `ffi.library/interface/symbols`, or
`subprocess.command/tools`.

## 5. Register and test locally

From the repo root:

```bash
bun run server
```

Smoke checks:

```bash
curl -sf http://localhost:47778/api/plugins | jq '.plugins[] | select(.name == "hello-oracle")'
curl -sf 'http://localhost:47778/api/plugins/hello-oracle?name=Ada'
curl -sf http://localhost:47778/api/v1/mcp/tools | jq '.tools[] | select(.name == "oracle_hello")'
curl -sf 'http://localhost:47778/api/plugins/hello-sidecar/server/echo?q=ok'
```

Focused repo checks for plugin changes:

```bash
bun test src/plugins/__tests__/unified-loader.test.ts tests/plugins/unified-manifest-surfaces.test.ts
bun test tests/http/plugins/server-health.test.ts tests/http/plugins/server-proxy.test.ts
bunx tsc --noEmit
```

When writing fixture tests, call `loadUnifiedPlugins({ dirs: [fixtureDir] })` so
user-installed plugins do not affect results. API route surfaces are mounted when
the Elysia app is composed; restart the server after adding new routes. MCP tool
metadata can be refreshed by `runtime.reload()` in tests and hot-reload paths.
