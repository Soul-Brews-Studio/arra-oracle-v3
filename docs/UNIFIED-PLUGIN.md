# Unified plugin manifest

Issue #1412 extends the plugin taxonomy from `docs/PLUGIN-TAXONOMY.md` into one
manifest shape. The goal is one `plugin.json` that can declare every capability a
plugin contributes while preserving the current ServerPlugin, Installed/Wasm,
CanvasPlugin, and CLI plugin surfaces.

This is a design-first slice: schema, migration map, reference manifest, and
validation tests. Runtime wiring should land surface-by-surface after this doc is
accepted.

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

## MCP tool registration gap

This is the largest missing capability. Today MCP tools are static:

1. definitions are imported from `src/tools/*`;
2. `src/index.ts` lists them in `ListToolsRequestSchema`;
3. calls are routed by a `switch (toolName)`;
4. `src/config/tool-groups.ts` only knows static names in `TOOL_GROUPS`.

A plugin MCP tool needs a dynamic registry before it can be advertised or called:

```ts
type RegisteredMcpTool = {
  pluginName: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  group: string;              // e.g. "canvas" or "plugin:<name>"
  readOnly: boolean;
  enabledByDefault: boolean;
  call(args, ctx): Promise<ToolResponse>;
};
```

Recommended runtime flow:

1. load and normalize all unified manifests;
2. for each `mcpTools[]` item, import `entry` and bind `handler`;
3. append registered tool definitions to `ListToolsRequestSchema` output;
4. before the static `switch`, dispatch `toolName` to the dynamic registry;
5. extend tool toggles so plugin tools are known names, not ignored typos.

### Toggle integration (#1372)

`getDisabledTools()` currently rejects names not present in its static
`ALL_TOOL_NAMES`. Plugin tools need an additional known-tool set:

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

## Non-goals for this PR

- No dynamic MCP execution yet.
- No generic proxy/server process manager yet.
- No npm package extraction.
- No subdomain deploy work.
