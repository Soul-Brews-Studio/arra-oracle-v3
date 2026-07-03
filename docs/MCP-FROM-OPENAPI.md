# OpenAPI → MCP tool generator

Prototype (Phase 1): read the Elysia `/swagger/json` spec and emit one MCP
tool definition per `(path, method)` pair. Phase 1 **generates and prints
only** — it does not yet replace the hand-rolled registration in
`src/index.ts`.

Script: [`scripts/mcp-from-openapi.ts`](../scripts/mcp-from-openapi.ts).

## Why

`src/tools/mcp-manifest.ts` currently exposes 28 core MCP tools, while the HTTP server
already describes 50+ endpoints through Elysia's TypeBox models, surfaced
at `/swagger/json`. Every time a new route lands we duplicate the schema
by hand in a tool def. The OpenAPI doc is the source of truth; the MCP
tool list should fall out of it.

## Usage

```sh
# Fetch from live server (default port from $ORACLE_PORT, else 47778):
bun scripts/mcp-from-openapi.ts

# Point at a specific URL:
bun scripts/mcp-from-openapi.ts --url http://localhost:47790/swagger/json

# Or load from a static fixture — useful when the server isn't running:
bun scripts/mcp-from-openapi.ts --file scripts/fixtures/swagger.sample.json

# Compact JSON (one line):
bun scripts/mcp-from-openapi.ts --compact
```

JSON tool defs go to stdout. A progress line (generated count, path count,
comparison to the 27-tool core manifest) goes to stderr. Exit code 2 if the
generated count drops below the current baseline.

If the live fetch fails, the script falls back to the committed fixture at
`scripts/fixtures/swagger.sample.json` (captured 2026-04-19).

## Mapping rules

| OpenAPI | MCP Tool |
|---|---|
| `paths["/api/search"].get` | `{ name, description, inputSchema }` |
| `operation.summary` \|\| `operation.description` \|\| route | → `description` (with `"METHOD /path"` suffix) |
| `parameters` (query + path) | → `inputSchema.properties` |
| `parameters[].required` (or `in: path`) | → `inputSchema.required[]` |
| `requestBody.content["application/json"].schema` | merged into `inputSchema` |

### Tool name

`arra_<slug>` where `<slug>` is the path with:

- leading `api/` stripped
- `{param}` replaced with `by_param`
- non-alphanumerics collapsed to `_`
- lowercased

Examples:

| Path | Method | Tool name |
|---|---|---|
| `/api/search` | GET | `arra_search` |
| `/api/thread/{id}` | GET | `arra_thread_by_id` |
| `/api/traces/{id}/chain` | GET | `arra_traces_by_id_chain` |
| `/` | GET | `arra_root` |

### Collisions (GET + POST on same path)

First-come keeps the base name; later methods prefix with the verb:

| Path | Method | Tool name |
|---|---|---|
| `/api/supersede` | GET | `arra_supersede` |
| `/api/supersede` | POST | `arra_post_supersede` |

### Body merge

If the operation has a JSON request body whose schema is an object, its
properties are merged into `inputSchema.properties` alongside query/path
params. If the body schema is non-object or opaque (Elysia emits `{}` for
untyped bodies), it becomes a single `body` property. Required fields
from the body schema are added to `inputSchema.required`.

Path params are marked with `"x-param-in": "path"` so a future router can
tell path from body when reconstructing the URL.

## Current numbers (fixture 2026-04-19)

Current core MCP manifest count is 27: `____IMPORTANT` plus 26 `oracle_*`
tools, including `oracle_research_note`, `oracle_profile`, and
`oracle_trace_distill`.

- 51 paths in `/swagger/json`
- **55 tools generated** (4 paths expose both GET and POST)
- 28 tools in the current core manifest → **+27 net**

## Known gaps (Phase 1)

- **TypeBox introspection is shallow.** Elysia's swagger emits `schema: {}`
  for many request bodies because the route uses `t.Object({...})` but
  derives it dynamically (e.g. `/api/learn`, `/api/supersede POST`). The
  generator preserves whatever the OpenAPI doc gives; it does not re-read
  TypeBox models from source. Phase 2 should either (a) teach Elysia's
  swagger plugin to emit the schemas, or (b) import the TypeBox models
  directly and run `Value.Compile` → JSON Schema on them.
- **No `____IMPORTANT` meta tool.** The current manifest prepends this guide
  tool before the 26 `oracle_*` tools. A generator pass can't synthesise it —
  wire it in at the composition layer, not at generation time.
- **`operationId` is ignored.** Elysia autogenerates names like
  `getApiSearch`. The slug-based name is stabler across route renames and
  reads better in Claude's tool picker. Keep the current scheme.
- **No response schemas.** MCP tool defs don't carry output schemas, so
  we drop `responses`. If MCP ever adds output schemas, revisit.
- **Auth / read-only filtering is not applied.** Current server hides
  write tools when `--readonly` is set. The generator emits everything;
  filtering remains the responsibility of the composition layer.

## Next steps (Phase 2, wire to live Server)

1. Extract a handler-lookup layer: `toolName → async (input) => httpCall`.
   Most tools can be implemented as a thin HTTP proxy into the Elysia
   server (internal `app.handle(new Request(...))` — no socket hop).
2. At `src/index.ts` boot, load `/swagger/json` (or build from the
   Elysia app object directly via `app.swagger`) instead of importing
   `*ToolDef` constants.
3. Fold `WRITE_TOOLS` and `disabledTools` filtering into a post-generation
   pass, keyed by OpenAPI `tags` (we already tag routes with
   `nav:hidden`, `order:10`, etc.).
4. Keep `____IMPORTANT` plus hand-written tools such as `oracle_research_note`,
   `oracle_profile`, and `oracle_trace_distill` until generator parity exists.
5. Delete `*ToolDef` constants from `src/tools/*` — the def is now
   derived, only the handler body remains.

## Design notes

- Keep the generator **read-only** and **side-effect free**. It reads an
  OpenAPI doc and writes JSON to stdout. No imports from `src/tools/*`,
  no DB access, no `src/index.ts` mutation. This makes it safe to run in
  CI as a diff check ("does the tool list drift from /swagger/json?").
- Fixture-first fallback keeps the script runnable in sandboxed CI where
  the Oracle HTTP server isn't booted.
- The exit-code-2 guard catches accidental regressions — e.g. if a
  future Elysia upgrade hides routes from the swagger doc, we want to
  fail loud, not silently shrink the MCP surface.
