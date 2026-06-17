# Federation mesh capability provider

Arra Oracle's current federation surface is an **opt-in mesh capability
provider**. The removed peer-pairing design is not present in the current source
tree and should not be documented as an active operator path.

Verified source paths:

- `src/routes/federation/index.ts` mounts the route cluster at
  `/api/federation`.
- `src/federation/capability-provider.ts` owns mesh-node registration,
  capability normalization, and status output.
- `src/server/plugin/builtin.ts` registers the `federation` route plugin as an
  `extra` plugin that is disabled by default.
- Removed peer discovery source files are absent from `src/`.

## Enable the route plugin

Federation is disabled on a bare `bun run server` or `arra-oracle-v3 serve`.
Enable it through the plugin allow-list:

```bash
ORACLE_ENABLED_PLUGINS=federation bun run server
# or after a global install
ORACLE_ENABLED_PLUGINS=federation arra-oracle-v3 serve
```

`ORACLE_DISABLED_PLUGINS=federation` wins if both enable and disable lists are
set. Legacy `ARRA_ENABLED_PLUGINS` / `ARRA_DISABLED_PLUGINS` are still parsed by
the plugin loader, but new deploy docs should use the `ORACLE_*` names.

## Routes

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/federation/status` | Provider status, node counts, active capabilities. |
| `GET` | `/api/federation/capabilities` | Active capability list plus mesh node count. |
| `GET` | `/api/federation/mesh/nodes` | Registered mesh nodes. |
| `POST` | `/api/federation/mesh/nodes/register` | Register or update one mesh node. |

The default local node is registered as `local-oracle` with provider
`arra-oracle-federation`. Its capabilities include:

- `maw:hey`
- `maw:peek`
- `federation:status`
- `federation:mesh-register`
- `mcp:tools`
- `vector:proxy`

The self URL is resolved from `ORACLE_HTTP_URL`, then `ORACLE_API`, then
`http://127.0.0.1:$ORACLE_PORT` / `$PORT`, defaulting to port `47778`.

## Smoke checks

```bash
ORACLE_ENABLED_PLUGINS=federation bun run server

curl -sf http://localhost:47778/api/federation/status | jq
curl -sf http://localhost:47778/api/federation/capabilities | jq
curl -sf http://localhost:47778/api/federation/mesh/nodes | jq
```

Expected status shape:

```json
{
  "ok": true,
  "provider": "arra-oracle-federation",
  "nodes": 1,
  "activeNodes": 1,
  "capabilities": ["federation:mesh-register", "federation:status", "maw:hey", "maw:peek", "mcp:tools", "vector:proxy"]
}
```

Register a relay or sibling Oracle node:

```bash
curl -s -X POST http://localhost:47778/api/federation/mesh/nodes/register \
  -H 'content-type: application/json' \
  -d '{
    "id": "mesh-relay",
    "name": "Mesh Relay",
    "url": "https://relay.example.test",
    "capabilities": ["maw:hey", "maw:peek"],
    "metadata": { "role": "relay" }
  }' | jq
```

Node IDs accept letters, numbers, `.`, `_`, `:`, and `-`. URLs must be HTTP or
HTTPS. Empty metadata keys are dropped, and disabled nodes stay listed but do not
contribute capabilities.

## What not to document as current

Do not reintroduce the removed peer stack in current docs. Current operator
instructions should point to `/api/federation/*`, the mesh-node registry, and the
`ORACLE_ENABLED_PLUGINS=federation` gate only.

## Verification

Use these checks after changing federation docs or code:

```bash
bun test src/federation/__tests__/capability-provider.test.ts \
  src/server/__tests__/server-plugin-loader.test.ts
bunx tsc --noEmit
```

Useful source probes:

```bash
find src/routes -maxdepth 2 -type d | grep federation
sed -n '1,180p' src/federation/capability-provider.ts
```

## Related deploy docs

- [workers-deploy-configs.md](./workers-deploy-configs.md) — Workers deploy
  configuration examples.
- [deploy-production.md](./deploy-production.md) — production deploy checklist.
- [architecture/deploy-topologies.md](./architecture/deploy-topologies.md) —
  local, edge, and split-service topologies.
