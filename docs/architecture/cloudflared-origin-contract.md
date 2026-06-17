# Cloudflared origin contract (#2227 Slice 0c)

`ORACLE_ORIGIN_URL` is the canonical secret for Workers that need to reach the
Bun-backed Arra Oracle origin. It should point at a Cloudflare Tunnel or another
HTTPS URL that terminates at `maw arra serve`.

## Decision

For production CF Workers deployments, commit to this shape:

```text
Studio Worker / MCP Worker
  -> ORACLE_ORIGIN_URL secret
  -> cloudflared HTTPS tunnel
  -> maw arra serve backend
  -> optional vector sidecar
```

This keeps Workers thin and avoids claiming the edge is self-contained. Workers
serve static assets, MCP transport, and proxy logic; the backend remains the
origin for REST, plugin runtime, tenant auth, local DB, and vector access.

## Secret contract

| Name | Set where | Required for | Meaning |
| --- | --- | --- | --- |
| `ORACLE_ORIGIN_URL` | Worker secret | Production Studio and MCP Workers | HTTPS base URL for the Bun origin. Prefer this over committed vars. |
| `ORACLE_URL` | Worker var or secret | Local/dev fallback | Legacy backend URL alias. Keep only for compatibility. |
| `ORACLE_HTTP_URL` / `ORACLE_API` | Env/secret fallback | Legacy clients | Last-resort aliases when neither origin var is set. |
| `TUNNEL_URL` | Federation Worker var/secret | Federation only | Narrow maw/session relay target, not the full Studio/MCP origin. |

Rules:

- Use the origin root, for example `https://oracle-origin.example.com`.
- Do not include `/api/*`, `/mcp`, query strings, fragments, or credentials.
- The backend must answer `GET /api/health` at that origin.
- Store production values with `wrangler secret put`; do not commit real tunnel
  URLs or tokens to `wrangler.jsonc`.
- Keep `ARRA_API_TOKEN` / `ARRA_API_KEY` as separate backend auth secrets.

## Local quick tunnel

```bash
maw arra serve --port 47778
cloudflared tunnel --url http://127.0.0.1:47778
```

Copy the generated HTTPS URL, then set it as the Worker secret:

```bash
cd workers/studio
bunx wrangler secret put ORACLE_ORIGIN_URL

cd ../mcp
bunx wrangler secret put ORACLE_ORIGIN_URL
```

Use `wrangler dev --remote` or deploy and verify:

```bash
curl -sf "$ORACLE_ORIGIN_URL/api/health"
curl -sf "https://<studio-worker>/api/health"
```

## Named tunnel production shape

Use a named tunnel when the origin URL should be stable:

```bash
cloudflared tunnel create arra-oracle-origin
cloudflared tunnel route dns arra-oracle-origin oracle-origin.example.com
```

Create the tunnel ingress config on the origin host:

```yaml
tunnel: arra-oracle-origin
ingress:
  - hostname: oracle-origin.example.com
    service: http://127.0.0.1:47778
  - service: http_status:404
```

Run the tunnel next to the backend:

```bash
maw arra serve --port 47778
cloudflared tunnel run arra-oracle-origin
```

Then set the Worker secrets to `https://oracle-origin.example.com`.

## Worker behavior

- `workers/studio` resolves backend origin in this order:
  `ORACLE_ORIGIN_URL`, `ORACLE_URL`, `ORACLE_HTTP_URL`, `ORACLE_API`.
- `workers/mcp` resolves the same order for proxied tool calls.
- `ORACLE_MCP_URL` may still point Studio at a separate MCP Worker; if unset,
  Studio falls back to `${ORACLE_ORIGIN_URL}/mcp` through the backend origin.
- `workers/federation` keeps using `TUNNEL_URL` because it relays only selected
  coordination routes.

## Acceptance checks

- `ORACLE_ORIGIN_URL` is configured as a secret in every production Worker that
  proxies to the backend.
- `/api/health` succeeds through the tunnel before deploying Workers.
- Workers never import native DB/vector code to replace the origin.
- Docs and runbooks refer to the origin-plane guarantee: edge availability does
  not imply search/plugin behavior works when the origin tunnel is down.
