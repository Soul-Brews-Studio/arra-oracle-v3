# Unified Plugin Guide

The unified plugin system lets one `plugin.json` publish server, API, MCP, menu,
and CLI surfaces. The loader lives in `src/plugins/unified-loader.ts`; the shared
manifest contract lives in `src/plugins/unified-manifest.ts`.

## Where plugins live

By default the unified loader scans these directories, in order:

1. `~/.arra/plugins/<plugin-name>/plugin.json`
2. `~/.oracle/plugins/<plugin-name>/plugin.json`

Each plugin directory must contain a manifest and the entry module named by
`entry`. The loader skips invalid manifests, disabled manifests, and duplicate
plugin names already seen earlier in the scan.

## Minimal shape

```json
{
  "name": "smoke-loader",
  "version": "1.0.0",
  "entry": "./index.ts",
  "description": "Example unified plugin",
  "apiRoutes": [
    { "path": "/api/smoke-loader", "methods": ["GET"], "handler": "api" }
  ],
  "mcpTools": [
    {
      "name": "smoke_loader_tool",
      "description": "Smoke tool",
      "inputSchema": {},
      "handler": "tool"
    }
  ],
  "menu": [
    { "label": "Smoke Loader", "path": "/smoke-loader", "group": "tools" }
  ],
  "cliSubcommands": [
    { "command": "smoke-loader", "help": "Run smoke loader", "handler": "cli" }
  ]
}
```

Validation rules:

- `name` must match `/^[a-z0-9-]+$/`.
- `version` must begin with semver (`1.2.3`, prerelease suffix allowed).
- `entry` is a module path relative to the plugin directory.
- `apiRoutes.path`, `proxy.path`, `menu.path`, and `server.healthPath` must be absolute.
- `apiRoutes.methods` and `proxy.methods` accept `GET`, `POST`, `PUT`, `PATCH`,
  `DELETE`, `OPTIONS`, `HEAD`, or `ALL`.
- `mcpTools.name` must match `/^[a-z][a-z0-9_]*$/`.
- `server.args` must be strings; `server.env` must be a string map.

Legacy aliases still normalize into the unified shape:

- `cli: { command, help }` becomes one `cliSubcommands` entry.
- `api: { path, methods }` becomes one `apiRoutes` entry.

## Entry module authoring

Export one function per named handler, or use `default` when a surface omits
`handler`.

```ts
export function api(ctx) {
  return { body: { ok: true, query: ctx.query } };
}

export function tool(ctx) {
  return { ok: true, body: ctx.body };
}

export function cli(ctx) {
  const name = ctx.args[0] ?? 'world';
  ctx.writer?.(`hello ${name}`);
  return { ok: true, output: `done ${name}` };
}
```

API and MCP handlers are invoked by `src/plugins/unified-loader.ts` with a context
containing `source`, `plugin`, and surface-specific fields such as `request`,
`params`, `query`, `body`, or `args`. API handlers may return a `Response`, a
plain body, or an invoke result:

```ts
{ ok: true, body: { ... } }
{ ok: true, output: "text" }
{ ok: false, status: 400, error: "bad input" }
```

CLI handlers are invoked by `cli/src/plugin/invoke.ts` with `ctx.args` and
`ctx.writer`. Return `{ ok: true, output }` or `{ ok: false, error }`. If
`handler` is absent on a CLI subcommand, the CLI calls the default export.

## Surfaces

### `apiRoutes`

Creates Elysia routes directly in the main server. Each route declares a path,
optional methods, and optional handler. The main server appends these to its API
module list after core route clusters.

### `mcpTools`

Adds tool definitions to the MCP registry. The server-side runtime can dispatch
with `runtime.callMcpTool(name, args)`, and `/api/mcp/tools` exposes core and
plugin tool definitions to frontends.

### `proxy`

Creates proxy routes with `createUnifiedProxyRoute`. Use this when the plugin has
an external service URL in an environment variable and the Oracle server should
forward matching API calls.

### `server`

Declares a child process service:

```json
{
  "server": {
    "command": "bun",
    "args": ["index.ts"],
    "healthPath": "/health",
    "autostart": false,
    "env": { "EXAMPLE_MODE": "smoke" }
  }
}
```

The unified server runtime allocates a port, injects `ARRA_PLUGIN_NAME`,
`ARRA_PLUGIN_PORT`, and `PORT`, then proxies through
`/api/plugins/<name>/server/*`. `autostart: false` delays startup until a server
route is requested.

### `menu`

Adds navigation items to `/api/menu` as `source: "plugin"`. The boot seeder also
persists plugin menu rows into `menu_items` with `source='plugin'` unless a
non-plugin row already owns the same path.

Groups default to `tools`; accepted groups are `main`, `tools`, and `hidden`.
Menu items are navigation only: pair a menu item with an `apiRoutes`, `proxy`, or
`server` path when clicking it should open a plugin feature.

### `cliSubcommands`

Adds commands to `arra-cli`. The CLI loader scans unified plugin directories
before legacy CLI plugins, registers `cliSubcommands`, and resolves by command
name. Dispatch uses `InvokeContext`:

```ts
export function cli(ctx) {
  const [subcommand, ...rest] = ctx.args;
  ctx.writer?.('optional progress');
  return { ok: true, output: JSON.stringify({ subcommand, rest }) };
}
```

`help` appears in `arra-cli --help` and `arra-cli -h <command>`. The command
handler receives only arguments after the command name.

## Registration flow

Server boot:

1. `src/server.ts` calls `loadUnifiedPlugins()`.
2. The loader scans plugin dirs and normalizes each manifest.
3. `runtime.routes` is mounted with the core Elysia modules.
4. `runtime.servers` is passed to `startUnifiedPluginServers()`.
5. `runtime.menu` is persisted via `seedUnifiedPluginMenuItems()` and merged into
   `/api/menu` through `menuItemsFromUnifiedPlugins()`.
6. `runtime.mcpTools` is passed to `createMcpRoutes()` for `/api/mcp/tools`.

CLI boot:

1. `cli/src/cli.ts` calls `discoverPlugins()`.
2. `cli/src/plugin/loader.ts` imports unified manifests first, then legacy user
   and bundled CLI plugins.
3. `registerPlugins()` records commands from legacy `cli` and unified
   `cliSubcommands`.
4. `resolveCommand()` selects the command; `invokePluginCommand()` imports the
   entry module and calls the requested handler.

## Quick local check

```bash
mkdir -p ~/.oracle/plugins/smoke-loader
cp plugin.json index.ts ~/.oracle/plugins/smoke-loader/
bun src/server.ts
arra-cli --help
arra-cli smoke-loader test
curl http://localhost:47778/api/menu
curl http://localhost:47778/api/mcp/tools
```

For tests, prefer isolated plugin directories and call
`loadUnifiedPlugins({ dirs: [fixtureDir] })` so local user plugins do not affect
the result.
