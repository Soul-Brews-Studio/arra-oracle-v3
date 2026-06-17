# Arra Oracle Cloudflare MCP Worker

This Worker exposes a remote MCP endpoint at `/mcp` and proxies safe Oracle
MCP tools to a running Arra Oracle HTTP backend. It is the #2167 make-it-work
path for sharing one deployed MCP URL across a team, school, or organization.

## What it runs

- `muninn_search` -> `GET /api/search`
- `muninn_stats` -> `GET /api/stats`
- `oracle_learn` -> `POST /api/learn`

The Worker does not host the full local database or vector index. It forwards
tool calls to `ORACLE_URL` and adds auth/tenant headers when configured.

## Quickstart: deploy

1. Start or expose an Arra Oracle HTTP backend.

   ```bash
   bun src/server.ts
   ```

   For local testing through Cloudflare, expose it with a trusted tunnel and use
   the public HTTPS URL as `ORACLE_URL`.

2. Configure the Worker backend URL.

   Edit `workers/mcp/wrangler.jsonc`:

   ```jsonc
   "vars": {
     "ORACLE_URL": "https://your-oracle-backend.example.com"
   }
   ```

3. Install and deploy.

   ```bash
   cd workers/mcp
   bun install
   bunx wrangler login
   bunx wrangler deploy
   ```

4. If your backend requires an API token, store it as a Worker secret.

   ```bash
   bunx wrangler secret put ARRA_API_TOKEN
   ```

After deploy, your MCP URL is:

```text
https://<worker-name>.<account>.workers.dev/mcp
```

## Connect Claude

Claude Desktop can connect through `mcp-remote`:

```json
{
  "mcpServers": {
    "arra-oracle-cloudflare": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://<worker-name>.<account>.workers.dev/mcp"
      ]
    }
  }
}
```

Save the config, restart Claude Desktop, and complete the browser auth flow if
OAuth or Cloudflare Access is enabled. If your Claude client supports remote MCP
URLs directly, use the same `/mcp` URL.

## Test the deployment

Run local Worker tests from the repository root before deploy:

```bash
bun test tests/workers/mcp-proxy-tools.test.ts tests/workers/mcp-proxy.test.ts
bunx tsc --noEmit
```

Smoke test the deployed MCP endpoint with MCP Inspector:

```bash
npx @modelcontextprotocol/inspector@latest
```

In the Inspector UI, connect to:

```text
https://<worker-name>.<account>.workers.dev/mcp
```

Then run **List Tools** and call `muninn_stats`. If the backend is protected,
confirm `ARRA_API_TOKEN` is set and the upstream server accepts bearer tokens.

## Config reference

| Name | Where | Required | Purpose |
| --- | --- | --- | --- |
| `ORACLE_URL` | `wrangler.jsonc` var | Yes | HTTPS base URL for the Arra Oracle HTTP backend. |
| `ORACLE_HTTP_URL` | env/secret | No | Legacy fallback backend URL. Used only when `ORACLE_URL` is unset. |
| `ORACLE_API` | env/secret | No | Legacy fallback backend URL after `ORACLE_HTTP_URL`. |
| `ARRA_API_TOKEN` | secret | No | Bearer token sent to the backend as `Authorization`. |
| `ARRA_API_KEY` | secret | No | Legacy token fallback when `ARRA_API_TOKEN` is unset. |
| `ORACLE_TENANT_ID` | var/secret | No | Default tenant for unauthenticated single-tenant deploys. |
| `MCP_OBJECT` | Durable Object binding | Yes | Session state binding required by `McpAgent`. |

`ORACLE_URL` is not a database URL. It should point to the backend HTTP origin,
for example `https://oracle.example.com`, not directly to `/mcp` or `/api/*`.

## OAuth and tenant claims

For team or school deployments, wrap the Worker with Cloudflare
`workers-oauth-provider` or Cloudflare Access so authenticated users receive a
tenant claim. The `McpAgent` receives auth props and the proxy resolves tenants
from these claim keys:

- `tenantId`
- `tenant_id`
- `tenant`
- `orgId`
- `org_id`
- `organizationId`
- `organization_id`
- the same keys under `claims`

When a tenant is resolved, the Worker forwards all backend-compatible headers:

```text
X-Tenant-ID: <tenant>
X-Oracle-Tenant: <tenant>
X-Oracle-Tenant-ID: <tenant>
```

Use `ORACLE_TENANT_ID` only for single-tenant or smoke-test deploys. In shared
production deploys, prefer OAuth/Access claims so users cannot select another
tenant by changing tool arguments.

## Troubleshooting

- **No tools in Claude:** verify the URL ends with `/mcp`, restart Claude, then
  try MCP Inspector to separate client config from Worker issues.
- **Backend calls fail:** check `ORACLE_URL`, token secrets, and that the backend
  exposes `/api/search`, `/api/stats`, and `/api/learn`.
- **Tenant isolation looks wrong:** verify the OAuth token includes one of the
  supported tenant claim keys, or set `ORACLE_TENANT_ID` for a single-tenant
  smoke test.
- **Direct browser visit fails:** `/mcp` expects MCP protocol messages; use
  Claude, `mcp-remote`, or MCP Inspector instead.
