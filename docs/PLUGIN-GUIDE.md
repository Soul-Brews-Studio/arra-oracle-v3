# Plugin authoring guide

Arra plugins should feel installable like editor plugins: publish one folder (or
artifact) with a `plugin.json`, let the installer place it in a plugin home, and
let Arra discover it at boot.

## Target install UX

Users should not clone Arra core to add a plugin. The target flow is one command
that fetches a plugin repo or artifact, writes it to a plugin home, then lets Arra
discover it on the next server/CLI start:

```bash
arra plugin install github.com/owner/oracle-plugin --dry-run
arra plugin install github.com/owner/oracle-plugin
arra plugin list
```

Today, use that installer for packaged artifact plugins that declare `wasm` and
optional `build`. Use copy/symlink install for unified TypeScript plugin folders
until source installs consume unified manifests directly.

During development, copy or symlink the plugin directory into a scan path:

```bash
mkdir -p ~/.maw/plugins
ln -s "$PWD" ~/.maw/plugins/my-plugin
arra-oracle-v3 serve --port 47778
arra --help
```

The unified runtime scans `.maw/plugins` from the current directory and each
parent directory first, then `$MAW_PLUGINS_DIR`, then `~/.maw/plugins`,
`~/.arra/plugins`, and `~/.oracle/plugins`.

## Minimal unified plugin

```json
{
  "name": "hello-oracle",
  "version": "1.0.0",
  "entry": "./index.ts",
  "description": "Hello plugin for Arra Oracle",
  "apiRoutes": [
    { "path": "/api/plugins/hello-oracle", "methods": ["GET"], "handler": "api" }
  ],
  "menu": [
    { "label": "Hello Oracle", "path": "/plugins/hello-oracle", "group": "tools" }
  ],
  "cliSubcommands": [
    { "command": "hello-oracle", "help": "Say hello", "handler": "cli" }
  ],
  "mcpTools": [
    {
      "name": "oracle_hello",
      "description": "Return a hello payload",
      "inputSchema": { "type": "object", "properties": {} },
      "handler": "tool",
      "enabled": true,
      "readOnly": true
    }
  ]
}
```

Set `"enabled": false` on an `mcpTools[]` item to plug that tool out completely.
Use `"enabledByDefault": false` when the tool should stay registered but require
explicit config opt-in before it is listed by default.

## Entry module

Export one function per handler named in the manifest. Return a plain response or
an invoke-style result.

```ts
export function api(ctx) {
  return { ok: true, body: { plugin: ctx.plugin, query: ctx.query } };
}

export function cli(ctx) {
  const name = ctx.args[0] ?? 'operator';
  return { ok: true, output: `hello ${name}` };
}

export function tool(ctx) {
  return { ok: true, body: { message: 'hello from MCP', args: ctx.body } };
}
```

Context includes `source`, `plugin`, and surface-specific fields such as
`request`, `query`, `body`, `params`, `args`, and `writer`.

## Manifest rules

- `name` must match `/^[a-z0-9-]+$/`.
- `version` must start with semver, e.g. `1.0.0` or `1.0.0-alpha.1`.
- `entry` is relative to the plugin directory and must stay inside it.
- Route, proxy, menu, and health paths must start with `/`.
- HTTP methods may be `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`,
  `HEAD`, or `ALL`.
- MCP tool names must match `/^[a-z][a-z0-9_]*$/`.
- `server.args`, `server.env`, and `depends` must be string arrays/maps as
  documented by the schema.

## Surfaces checklist

| Surface | Add when | Smoke check |
| --- | --- | --- |
| `apiRoutes[]` | The plugin exposes HTTP behavior | `curl /api/plugins/<name>` |
| `mcpTools[]` | Agents need a tool | `curl /api/mcp/tools` or MCP tools/list |
| `menu[]` | Studio should show navigation | `curl /api/menu` |
| `cliSubcommands[]` | Operators need terminal access | `arra <command> --help` |
| `proxy[]` | Arra should front an external service | hit the proxy path |
| `server` | The plugin owns a child process | hit `/api/plugins/<name>/server/*` |
| `exportFormats[]` | Export app needs a new format | list export formats |

## Packaging for easy install

A plugin repo should keep the installable files at its root:

```text
plugin.json
index.ts            # or dist/index.js
README.md
LICENSE
```

If you ship a prebuilt artifact for the current `arra plugin install` artifact
path, include a manifest with artifact metadata:

```json
{
  "name": "hello-oracle",
  "version": "1.0.0",
  "wasm": "hello-oracle.wasm",
  "build": "bun run build"
}
```

Use `--artifact <url> --manifest <url>` for direct artifact installs. Use
`--force` only when replacing an existing local install.

## Local validation

```bash
bun test tests/plugins/unified-manifest-surfaces.test.ts
bun test tests/cli/plugin/loader-discovers-unified-plugin.test.ts
bunx tsc --noEmit
```

For fixture-driven tests, call `loadUnifiedPlugins({ dirs: [fixtureDir] })` so a
user's local plugins do not affect the result.

## MCP tool in/out during development

Unified plugin MCP tools can be added or removed without editing core code. The
runtime keeps a mutable MCP registry:

```ts
const runtime = await loadUnifiedPlugins({ dirs: ['~/.maw/plugins'] });
await runtime.reload(); // re-scan plugin.json files and update mcpTools in place
```

After reload, MCP `tools/list`, `/api/mcp/tools`, and `callMcpTool()` see the
new tool set. API route surfaces still require remounting or restarting the HTTP
app because Elysia routes are bound when the app is composed.

## Good plugin README

Include:

- Install command and required Arra version/tag.
- Surfaces provided: CLI, API, MCP, menu, proxy, server, export.
- Config/env variables and defaults.
- Smoke checks in fenced code blocks.
- Uninstall steps: remove the plugin folder from `.maw/plugins`, `~/.maw/plugins`,
  or the configured `$MAW_PLUGINS_DIR`, or use plugin remove when available.
