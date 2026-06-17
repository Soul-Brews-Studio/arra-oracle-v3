# Deploy topologies for the modular backend (#2227)

Use this guide to choose how to deploy Arra Oracle after the backend is split
into clear layers: edge hosts, the `maw arra` backend plugin, a separate vector
server, and pluggable MCP tools.

## Quick decision table

| Topology | Components | Use when | Avoid when | Primary knobs |
| --- | --- | --- | --- | --- |
| All-local | Studio dev server, `maw arra serve`, local DB, local or sidecar vector server, stdio MCP. | You need privacy, offline work, fast development, or a single-operator machine. | You need a public Studio/MCP URL or remote team access. | `maw arra serve`, `bun run vector:proxy`, `ORACLE_DATA_DIR`. |
| CF Workers edge + local backend | `workers/studio` static/API proxy, `workers/mcp`, optional `workers/federation`, local backend through a tunnel, vector sidecar near backend. | You want a public edge URL while keeping the brain/data on your machine or LAN. | You cannot keep a tunnel online or need all state to live at the edge. | `ORACLE_ORIGIN_URL`, `ORACLE_URL`, `ORACLE_MCP_URL`, `TUNNEL_URL`, `FEDERATION_TOKEN`. |
| Vercel frontend + backend URL | Vercel hosts `frontend/dist`; `api/proxy.ts` forwards `/api/*` to `ORACLE_URL`; backend/vector stay elsewhere. | Your team already uses Vercel and only needs Studio web hosting plus API proxying. | You need remote MCP on the same host or a private backend that Vercel cannot reach. | `vercel.json`, `ORACLE_URL`, Vercel env vars. |
| Federation tunnel | `workers/federation` signs and relays selected coordination routes to a cloudflared/local tunnel. | You need remote maw/session coordination without exposing the whole backend. | You need full Studio, full REST API, or vector traffic through the federation proxy. | `TUNNEL_URL`, `FEDERATION_TOKEN`, `/api/send`, `/api/sessions`. |

## Reference layer diagram

```text
public clients
  -> edge host (Cloudflare Workers, Vercel, or none)
  -> maw arra backend plugin (REST, auth, tenants, plugin runtime)
  -> vector server sidecar (LanceDB, Qdrant, TurboVec, proxy protocol)
  -> MCP/plugin packages (core + community tools)
```

The edge host is replaceable. The backend plugin is the product brain. The
vector server owns heavy search/indexing. MCP tools remain installable plugin
surfaces, not hardcoded edge routes.

## Topology details

### 1. All-local

All-local is the safest default for development and personal memory work.
Everything runs on one workstation or LAN host.

```bash
maw arra serve --port 47778
bun run vector:proxy              # optional separate vector sidecar
cd frontend && bun run dev        # optional Studio during development
```

Use this when:

- data should not leave the machine;
- the operator uses Claude Desktop or another local MCP client;
- you are testing plugin install/reload behavior;
- vector indexing needs local disk/GPU access.

Operational notes:

- Keep `ORACLE_DATA_DIR` on durable storage.
- Use stdio MCP or local HTTP (`http://127.0.0.1:47778`) for clients.
- If you split vector search out, point the backend at the sidecar with
  `ORACLE_PROXY_VECTOR_URL` or the durable vector proxy config.

### 2. CF Workers edge + local backend

This topology puts only the public shell at Cloudflare. Workers serve Studio,
remote MCP, or federation proxy routes, then forward to the backend over a public
backend URL or a tunnel. The production origin contract is `ORACLE_ORIGIN_URL` pointing at a Cloudflare Tunnel or equivalent HTTPS origin.

```bash
maw arra serve --port 47778
bun run vector:proxy
cloudflared tunnel --url http://127.0.0.1:47778
```

Use this when:

- users need a stable public Studio URL;
- Claude/agents need remote MCP over HTTPS;
- data and vector files must remain local or on a private VM;
- edge cache/auth is useful, but Workers should stay thin.

Operational notes:

- `workers/studio` uses `ORACLE_ORIGIN_URL` for the backend origin, with `ORACLE_URL` as a legacy/dev fallback, and `ORACLE_MCP_URL` for a separate MCP Worker.
- `workers/mcp` uses the same `ORACLE_ORIGIN_URL` secret when proxying tools to the backend and can use tenant registry data.
- `workers/federation` uses `TUNNEL_URL` and `FEDERATION_TOKEN` for selected maw
  coordination routes.
- Do not move native vector libraries or SQLite/LanceDB files into Workers. See [`cloudflared-origin-contract.md`](./cloudflared-origin-contract.md) before calling this topology production-ready.

### 3. Vercel frontend + backend URL

Vercel is the simplest web-UI option for teams already using Vercel. It hosts the
Vite build and proxies browser `/api/*` calls to the backend.

```bash
# Vercel build path
cd frontend && bun run build

# Backend remains separate
maw arra serve --port 47778
```

Use this when:

- the priority is one-click Studio hosting;
- the backend already has a reachable HTTPS origin;
- Vercel preview deployments are part of the team workflow.

Operational notes:

- `vercel.json` sets `buildCommand` and `outputDirectory` for `frontend/dist`.
- `api/proxy.ts` forwards `/api/*` to `ORACLE_URL`.
- Remote MCP should still use the Cloudflare MCP worker or another MCP-specific
  host until Vercel has a dedicated MCP route.

### 4. Federation tunnel

The federation proxy is not a full backend deploy. It is a narrow remote-control
path for maw/session coordination through a signed tunnel.

```bash
cloudflared tunnel --url http://127.0.0.1:47778
# Worker env: TUNNEL_URL=https://<tunnel>.trycloudflare.com
# Worker secret: FEDERATION_TOKEN=<shared secret>
```

Use this when:

- remote agents need to send maw messages or inspect local session state;
- you want HMAC-signed relay paths without exposing all `/api/*` routes;
- the main Studio/API surface stays local or behind another edge.

Operational notes:

- Current relay routes are `/api/send`, `/api/sessions`, and
  `/api/federation/status`.
- Requests are signed with `FEDERATION_TOKEN` and forwarded to `TUNNEL_URL`.
- Keep this topology scoped; add explicit relay routes rather than opening a
  catch-all proxy.

## Choosing a topology

- Pick **all-local** first for development, private memory, and plugin authoring.
- Pick **CF Workers edge + local backend** when you need public HTTPS for Studio
  or MCP but want storage/vector work near the operator.
- Pick **Vercel** when the web UI is the only public surface and the backend is
  already reachable.
- Pick **federation tunnel** for narrow remote coordination between agents and a
  local operator machine.

## Promotion path

1. Start all-local until `/api/health`, MCP tools, and vector search are green.
2. Split vector into `bun run vector:proxy` when indexing becomes heavy or needs
   a separate host.
3. Add Vercel or Cloudflare Workers for public Studio access; for Workers, set the `ORACLE_ORIGIN_URL` secret first.
4. Add the Cloudflare MCP worker for remote MCP clients.
5. Add federation tunnel only for signed coordination routes.

Each step should preserve the same backend contracts: authenticated HTTP to the
backend, explicit tenant headers, `/vectors/*` for vector sidecars, and plugin
surfaces loaded through unified-loader.
