# Production deploy with Cloudflare Workers and a tunneled Oracle origin

This runbook publishes the production shell while the Arra Oracle brain stays on
one trusted backend host. Cloudflare Workers serve Studio, remote MCP, and the
federation relay; `cloudflared` exposes the Bun backend through a stable HTTPS
origin consumed by `ORACLE_ORIGIN_URL`.

## Production shape

```text
Browser / Claude / agents
  -> Cloudflare Workers
     1. workers/mcp        /mcp remote MCP proxy
     2. workers/studio     Studio assets + /api/* and /mcp proxy
     3. workers/federation signed maw/session relay
  -> ORACLE_ORIGIN_URL or TUNNEL_URL
  -> maw arra serve on the origin host
  -> optional vector sidecar near the backend
```

Workers stay thin: they must not import local SQLite, LanceDB, vault files, or
native vector adapters. Keep persistence, plugin runtime, tenant scoping, and
indexing on the backend/vector plane.

## Prerequisites

- Cloudflare account with a zone for production hostnames.
- `bun`, `cloudflared`, and `wrangler` available locally.
- `wrangler login` completed for the target Cloudflare account.
- A backend host that can keep `maw arra serve` and `cloudflared` running.
- DNS names chosen, for example:
  - `oracle-origin.example.com` for the tunnel origin.
  - `studio.example.com` for Studio, if not using `workers.dev`.
  - `mcp.example.com` for remote MCP, if not using `workers.dev`.

## 1. Start the Oracle backend

On the origin host, generate one backend API token and keep it in your secret
manager. Use the same value for the backend and the proxy Workers.

```bash
export ARRA_API_TOKEN="$(openssl rand -hex 32)"
export ORACLE_DATA_DIR="$HOME/.arra-oracle"

maw arra serve --port 47778
# optional, if vector search is split out:
# bun run vector:proxy
```

Verify the local backend before adding Cloudflare:

```bash
curl -sf http://127.0.0.1:47778/api/health
```

## 2. Create the production cloudflared tunnel

Use a named tunnel for a stable origin URL.

```bash
cloudflared tunnel login
cloudflared tunnel create arra-oracle-origin
cloudflared tunnel route dns arra-oracle-origin oracle-origin.example.com
```

Record the tunnel UUID printed by `cloudflared tunnel create`:

```bash
export TUNNEL_ID="<uuid-from-create-output>"
```

Create the tunnel config on the origin host:

```yaml
# ~/.cloudflared/arra-oracle-origin.yml
tunnel: <TUNNEL_ID>
credentials-file: /home/oracle/.cloudflared/<TUNNEL_ID>.json
ingress:
  - hostname: oracle-origin.example.com
    service: http://127.0.0.1:47778
  - service: http_status:404
```

Run it next to the backend:

```bash
cloudflared tunnel --config ~/.cloudflared/arra-oracle-origin.yml run
```

Export and verify the production origin root. Do not include `/api`, `/mcp`,
query strings, credentials, or fragments.

```bash
export ORACLE_ORIGIN_URL="https://oracle-origin.example.com"
curl -sf "$ORACLE_ORIGIN_URL/api/health"
```

## 3. Store Worker secrets

Set `ORACLE_ORIGIN_URL` and the backend token on the Studio and MCP Workers.
Production values should be secrets, not committed `wrangler.jsonc` vars. Both
Workers resolve backend origins in this order: `ORACLE_ORIGIN_URL` > `ORACLE_URL`
> `ORACLE_HTTP_URL` > `ORACLE_API`.

```bash
for config in workers/mcp/wrangler.jsonc workers/studio/wrangler.jsonc; do
  printf '%s' "$ORACLE_ORIGIN_URL" |
    bunx wrangler secret put ORACLE_ORIGIN_URL --config "$config"
  printf '%s' "$ARRA_API_TOKEN" |
    bunx wrangler secret put ARRA_API_TOKEN --config "$config"
done
```

The federation Worker relays only selected maw/session paths, so it uses
`TUNNEL_URL` plus its own HMAC token.

```bash
export FEDERATION_TOKEN="$(openssl rand -hex 32)"
printf '%s' "$ORACLE_ORIGIN_URL" |
  bunx wrangler secret put TUNNEL_URL --config workers/federation/wrangler.jsonc
printf '%s' "$FEDERATION_TOKEN" |
  bunx wrangler secret put FEDERATION_TOKEN --config workers/federation/wrangler.jsonc
```

If Studio should connect directly to a separate MCP Worker, set this after the
MCP deploy URL is known:

```bash
export ORACLE_MCP_URL="https://arra-oracle-mcp.<account>.workers.dev/mcp"
printf '%s' "$ORACLE_MCP_URL" |
  bunx wrangler secret put ORACLE_MCP_URL --config workers/studio/wrangler.jsonc
```

## 4. Deploy Worker 1: remote MCP

```bash
cd workers/mcp
bun install
bunx tsc --noEmit
bunx wrangler deploy --config wrangler.jsonc
```

Record the deployed MCP URL:

```text
https://<mcp-worker-host>/mcp
```

Smoke test the deployed `/mcp` URL with MCP Inspector or a remote-capable MCP
client. The Worker does not expose `/health`; do not use `/health` as the MCP
probe. Select **List Tools** and confirm remoteable tools such as `oracle_search`
and `oracle_stats` appear. If tools return backend errors, re-check
`ORACLE_ORIGIN_URL` and `ARRA_API_TOKEN` secrets.

## 5. Deploy Worker 2: Studio frontend

Build the Vite assets, then deploy the Worker that serves assets and proxies
`/api/*` plus `/mcp`.

```bash
cd ../..
bun install
cd frontend
bun install
bun run build
cd ../workers/studio
bunx tsc --noEmit
bunx wrangler deploy --config wrangler.jsonc
```

Smoke checks:

```bash
curl -sf https://<studio-worker-host>/__health
curl -sf https://<studio-worker-host>/api/health
```

Open the Studio URL and confirm dashboard/search calls succeed. If `/mcp` should
use the separate MCP Worker, verify `ORACLE_MCP_URL` is set before redeploying or
creating a new Worker version.

## 6. Deploy Worker 3: federation relay

Deploy federation only when remote agents need signed maw/session coordination.
It does not expose the full backend.

```bash
cd ../federation
bunx wrangler deploy --config wrangler.jsonc
```

Smoke checks:

```bash
curl -sf https://<federation-worker-host>/__health
curl -i https://<federation-worker-host>/api/federation/status
```

Expected relay routes are `POST /api/send`, `GET /api/sessions`, and
`GET /api/federation/status`. Requests are signed with `FEDERATION_TOKEN` before
being forwarded to `TUNNEL_URL`.

## 7. Production verification checklist

- `curl -sf "$ORACLE_ORIGIN_URL/api/health"` succeeds from outside the origin
  host.
- Studio `GET /__health` and proxied `GET /api/health` both succeed.
- MCP Inspector can list tools at the deployed `/mcp` URL; no Worker `/health` probe is expected.
- MCP tenant forwarding is configured through auth props/claims, optional D1 tenants, or `ORACLE_TENANT_ID`.
- Federation `GET /__health` reports `tunnelConfigured: true`.
- Worker secrets are set with Wrangler or the Cloudflare dashboard; real URLs and
  tokens are not committed to git.
- Backend logs show requests with the expected tenant/auth headers.
- `cloudflared` and `maw arra serve` are supervised by systemd, launchd, Docker,
  or another process manager.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Worker says `Set ORACLE_ORIGIN_URL` | Secret was set on the wrong Worker/config or not deployed into the active environment. |
| Studio loads but API fails | Confirm `/api/health` works through `ORACLE_ORIGIN_URL` and that `ARRA_API_TOKEN` matches the backend. |
| MCP lists no tools | Use the `/mcp` URL with MCP Inspector; browser GET and `/health` are not valid MCP sessions. |
| Federation returns `tunnel unavailable` | Set `TUNNEL_URL` on `workers/federation/wrangler.jsonc` and redeploy. |
| Cloudflared 502/1033 | The backend is down, the tunnel config points at the wrong port, or DNS targets the wrong tunnel. |

## Related docs

- [Cloudflared origin contract](./architecture/cloudflared-origin-contract.md)
- [Deploy topologies](./architecture/deploy-topologies.md)
- [Cloudflare remote MCP](./deploy-cloudflare-mcp.md)
- [Vercel Studio deploy](./deploy-vercel.md)
- [Cloudflare Tunnel config files](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/configuration-file/)
