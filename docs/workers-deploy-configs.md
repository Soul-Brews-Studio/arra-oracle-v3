# Workers deploy config hardening

This repo keeps three active Cloudflare Worker deploy surfaces plus one retired
root teardown config. Use these commands before pushing deploy config changes:

```bash
bunx tsc --noEmit
bun run cloudflare:mcp:dry-run
bun run cloudflare:studio:dry-run
bun run cloudflare:federation:dry-run
```

`cloudflare:studio:*` builds `frontend/dist` first because Workers Static Assets
must exist before Wrangler can bundle the Studio worker.

## Deploy targets

| Surface | Wrangler config | Purpose | Dry-run proof |
| --- | --- | --- | --- |
| MCP | `workers/mcp/wrangler.jsonc` | Remote MCP endpoint at `/mcp`; proxies safe tools to an Oracle HTTP backend. | `bun run cloudflare:mcp:dry-run` must show `env.MCP_OBJECT` and `env.ORACLE_URL`. |
| Studio | `workers/studio/wrangler.jsonc` | Vite app + `/api/*` and `/mcp/*` edge proxy. | `bun run cloudflare:studio:dry-run` must show `env.ASSETS`, `env.ORACLE_URL`, and `env.ORACLE_MCP_URL`. |
| Federation | `workers/federation/wrangler.jsonc` | Narrow signed relay for `/api/send`, `/api/sessions`, and `/api/federation/status`. | `bun run cloudflare:federation:dry-run` must show `env.TUNNEL_URL`. |
| Root teardown | `wrangler.jsonc` | Retires the old `OracleMcpAgent` Durable Object only. | Do not use for new MCP deploys. |

## Environment variables and bindings

| Name | Surface | Where | Required | Notes |
| --- | --- | --- | --- | --- |
| `MCP_OBJECT` | MCP | Durable Object binding | Yes | Session state for Cloudflare `McpAgent`; class is `OracleMCP`. |
| `ORACLE_ORIGIN_URL` | MCP, Studio | secret | Production | Preferred HTTPS origin for the Bun API, usually a Cloudflare Tunnel or stable backend URL. |
| `ORACLE_URL` | MCP, Studio | `vars` fallback or secret | Dev/fallback | Committed placeholder only; replace or override for real deploys. |
| `ORACLE_HTTP_URL` | MCP, Studio | secret/env | Legacy fallback | Checked after `ORACLE_ORIGIN_URL` and `ORACLE_URL`. |
| `ORACLE_API` | MCP, Studio | secret/env | Legacy fallback | Last backend-origin alias. |
| `ORACLE_MCP_URL` | Studio | var/secret | Yes for split MCP | Points Studio `/mcp/*` traffic at the MCP Worker; if unset Studio falls back to backend `/mcp`. |
| `ARRA_API_TOKEN` | MCP, Studio | secret | If backend auth is enabled | Forwarded as `Authorization: Bearer ...`. |
| `ARRA_API_KEY` | MCP, Studio | secret | Legacy fallback | Used only when `ARRA_API_TOKEN` is absent. |
| `ORACLE_TENANT_ID` | MCP | var/secret | Optional | Single-tenant smoke-test default; prefer OAuth/Access claims for shared deploys. |
| `ORACLE_DB` | MCP | D1 binding | Optional | Enables tenant lookup for split/edge installs. |
| `ORACLE_TENANTS_TABLE` | MCP | var | Optional | Overrides the D1 tenant table name; defaults to `tenants`. |
| `ASSETS` | Studio | Workers Static Assets binding | Yes | Bound to `frontend/dist` with SPA fallback. |
| `TUNNEL_URL` | Federation | var/secret | Yes | HTTPS base URL for the narrow maw/session tunnel; not the full backend origin. |
| `FEDERATION_TOKEN` | Federation | secret | Yes | HMAC signing key. Never commit a real value. |
| `federationToken` | Federation | secret | Legacy fallback | Kept for existing Worker secrets; prefer `FEDERATION_TOKEN`. |

Keep real secrets in Wrangler or Cloudflare dashboard secrets. The committed
Wrangler files should contain placeholders only.
