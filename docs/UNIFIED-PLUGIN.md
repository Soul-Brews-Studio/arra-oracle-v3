# Unified plugin manifest

Issue #1412 extends the plugin taxonomy from `docs/PLUGIN-TAXONOMY.md` into one
manifest shape. The goal is one `plugin.json` that can declare every capability a
plugin contributes while preserving the current ServerPlugin, Installed/Wasm,
CanvasPlugin, and CLI plugin surfaces.

This started as a design-first slice: schema, migration map, reference manifest,
and validation tests. Alpha now includes the runtime loader bridge for API,
proxy, server, menu, CLI metadata, and plugin MCP tools.

## Manifest shape

```ts
type UnifiedPluginManifest = {
  name: string;
  version: string;
  entry: string;
  sdk?: string;
  tier?: 'core' | 'standard' | 'extra';
  enabled?: boolean;
  description?: string;

  mcpTools?: McpToolContribution[];
  apiRoutes?: ApiRouteContribution[];
  proxy?: ProxyContribution[];
  server?: ServerContribution;
  menu?: MenuContribution[];
  cliSubcommands?: CliSubcommandContribution[];

  // Back-compat aliases consumed by current loaders during migration.
  api?: { path: string; methods?: HttpMethod[] };
  lifecycle?: { start?: boolean; stop?: boolean };
  seedMenu?: boolean;
  cli?: { command: string; help: string };
};
```

The implemented TypeScript schema/normalizer lives in
`src/plugins/unified-manifest.ts`. A reference plugin manifest lives at
`docs/examples/unified-plugin/plugin.json`.

## Six capability surfaces

| Surface | Manifest key | Current owner | Unified migration |
| --- | --- | --- | --- |
| MCP tools | `mcpTools[]` | in-tree `src/tools/*` plus `src/index.ts` switch | Add dynamic MCP tool registry fed by normalized manifests. |
| API routes | `apiRoutes[]` | `ServerPlugin.api` + `routes()` | Normalize legacy `api` into `apiRoutes[]`; then mount via ServerPlugin bridge. |
| Proxy | `proxy[]` | gateway/vector-specific config | Add generic gateway entries from manifest path → target env. |
| Serve server | `server` | lifecycle/vector-server patterns | Spawn/health-check plugin-owned server from lifecycle manager. |
| URL/menu path | `menu[]` | menu DB/plugin metadata | Seed or expose menu contribution without treating it as renderer code. |
| CLI subcommand | `cliSubcommands[]` | `cli/src/plugins/*/plugin.json` | Normalize legacy `cli` into command entries and register with CLI loader. |


## Runtime loader

`src/plugins/unified-loader.ts` is the alpha runtime bridge. The HTTP server
loads normalized manifests at boot, then registers whichever surfaces are present:

- `apiRoutes[]` become Elysia routes that call the named handler from `entry`.
- `proxy[]` become best-effort Elysia proxy routes using `targetEnv`.
- `server` entries are autostarted unless `autostart: false`, get `PORT` /
  `ARRA_PLUGIN_PORT`, must pass `healthPath` (default `/health`), and are proxied
  behind `/api/plugins/<name>/server/*`.
- `menu[]` entries are seeded into `menu_items` as plugin-owned rows.
- `mcpTools[]` are registered as MCP tool definitions and dispatch back into the
  named manifest handler.
- `cliSubcommands[]` are collected as registry metadata for CLI loaders.

Missing surfaces are skipped. Invalid or failing plugin manifests are warned and
ignored so one plugin cannot prevent the server from booting.

## MCP tool plug in/out contract

Plugin MCP tools are declared per tool in `mcpTools[]`:

```ts
type RegisteredMcpTool = {
  pluginName: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  group: string;              // e.g. "canvas" or "plugin:<name>"
  readOnly: boolean;
  enabled?: boolean;          // false = do not register or invoke
  enabledByDefault: boolean;
  call(args, ctx): Promise<ToolResponse>;
};
```

Runtime flow:

1. load and normalize all unified manifests;
2. skip any `mcpTools[]` item with `"enabled": false`;
3. bind active tools to `entry` + `handler` in the unified runtime;
4. append active plugin tools to MCP listing output and dispatch calls through
   `UnifiedRuntime.callMcpTool()`;
5. include only active plugin tool names in tool-toggle known-name validation.

`enabledByDefault: false` is softer than `enabled: false`: the tool is
registered and callable when explicitly enabled by config, but it is not listed
by default. Use `enabled: false` to plug a tool out completely while keeping the
manifest entry documented.

### Toggle integration (#1372)

`getDisabledTools()` rejects names not present in its static `ALL_TOOL_NAMES`.
Plugin tools provide an additional known-tool set:

```ts
getDisabledTools(config, { extraToolNames: registry.toolNames() })
```

Resolution should stay the same:

1. disabled groups;
2. `disabled_tools` blocklist;
3. `enabled_tools` whitelist;
4. `allowed_tools` strict allow-list.

For groups, plugin tools can use their manifest `group` field. If no group is
provided, default to `plugin:<manifest.name>`. Existing config files keep working
because no static tool names change.

## Mapping existing plugin types

- **ServerPlugin** remains the runtime API/lifecycle adapter. Unified manifests
  normalize `api` → `apiRoutes[]` and `lifecycle`/`server` into a ServerPlugin
  bridge during migration.
- **InstalledPlugin/WasmPlugin** remains the local install/menu scanner. It can
  read unified `menu[]` later, but it should not execute renderer or MCP code.
- **CanvasPlugin** remains frontend bundled renderer code. Unified manifests may
  expose metadata/menu entries for canvas plugins, but must not imply dynamic
  unsigned React/Three execution.
- **CLI plugins** keep their current `cli` key until the CLI loader consumes
  `cliSubcommands[]` directly.

## Non-goals for this slice

- No restart/backoff supervisor changes for plugin-owned servers.
- No npm package extraction.
- No subdomain deploy work.
