# Deploy Arra Oracle remote MCP on Cloudflare Workers

This guide covers the docs-only operator path for #2167: one-click deploy, the
expected `McpAgent` Worker shape, and how to connect Claude to the deployed
`/mcp` endpoint. The Worker entry and Wrangler config are owned by the #2167
implementation slices; keep this page aligned with that code without editing
those files from docs-only PRs.

## What this deploy gives you

- A Cloudflare Worker that exposes Arra Oracle MCP tools at `/mcp`.
- Streamable HTTP transport handled by Cloudflare's Agents SDK.
- A `workers.dev` URL that Claude, MCP Inspector, Cursor, Windsurf, or another
  remote-capable MCP client can connect to.
- Optional auth via Cloudflare Access/OAuth once the make-it-work public endpoint
  is validated.

The first slice can expose only edge-safe tools. Local SQLite, filesystem vaults,
and full vector indexing need D1, Vectorize, R2, or proxy-backed replacements
before they run fully on Workers.

## One-click deploy

Use the Deploy to Cloudflare button once the #2167 Worker entry and Wrangler
config are present on `alpha`:

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Soul-Brews-Studio/arra-oracle-v3)

Cloudflare will clone the public repository, ask for Worker/project names,
provision supported bindings declared in Wrangler config, and build/deploy the
Worker. If the MCP Worker lives in a subdirectory, update the button URL to the
repository tree path for that isolated Worker directory before publishing the
button.

## Expected Worker shape

The remote MCP adapter should use Cloudflare `McpAgent` and export a handler on
`/mcp`:

```ts
import { McpAgent } from 'agents/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export class ArraOracleMcp extends McpAgent {
  server = new McpServer({ name: 'arra-oracle', version: '1.0.0' });

  async init() {
    this.server.tool('oracle_ping', { message: z.string().optional() }, async () => ({
      content: [{ type: 'text', text: 'arra-oracle remote MCP ok' }],
    }));
  }
}

export default ArraOracleMcp.serve('/mcp');
```

Add real Oracle tools only when their dependencies are Workers-safe. Stateful
sessions require Durable Objects; data-backed tools should use D1/Vectorize/R2 or
proxy to a trusted Arra Oracle HTTP backend.

## Required configuration

Use the #2167 Wrangler config as source of truth. The likely minimum is:

| Setting | Purpose |
| --- | --- |
| `main` | Worker entry that exports `McpAgent.serve('/mcp')`. |
| `compatibility_date` | Current Workers compatibility date. |
| `compatibility_flags` | Include `nodejs_compat` only if the implementation needs Node APIs. |
| Durable Object binding | Required by `McpAgent` session state. |
| `ORACLE_HTTP_URL` | Optional backend URL when proxying to a full Arra Oracle server. |
| `ARRA_API_TOKEN` | Secret for protected backend calls; never commit real values. |
| D1/Vectorize/R2 bindings | Edge-native persistence/search replacements as tools expand. |

If auth is enabled, wrap `/mcp` with Cloudflare's OAuth provider or Access and
keep tool authorization tenant-aware.

## OAuth setup for shared tenants

For #2193 team/school deployments, do not publish one shared `/mcp` endpoint
with caller-supplied tenant IDs as the only boundary. Put OAuth in front of the
Worker, resolve the authenticated user to a tenant, and forward that tenant to
the Arra Oracle backend as `x-oracle-tenant-id`.

Recommended rollout:

1. Keep the Phase 1 proxy private or token-protected until OAuth is wired.
2. Add Cloudflare's OAuth Provider Library around `OracleMCP.serve('/mcp')`.
   Cloudflare supports Access, a third-party provider such as GitHub/Google, or
   a bring-your-own provider such as Auth0/WorkOS.
3. Define the auth context shape on `McpAgent`, then read `this.props` inside
   tool handlers. Map claims such as email domain, group, or org/team ID to an
   internal `tenantId`.
4. Ignore any user-supplied `tenantId` once OAuth is enabled. Forward only the
   trusted tenant from auth context:

```ts
type AuthContext = { claims: { sub: string; email?: string }; tenantId: string };

export class OracleMCP extends McpAgent<Env, unknown, AuthContext> {
  async init() {
    this.server.tool('muninn_search', { query: z.string() }, async ({ query }) =>
      oracleProxyTool(this.env, {
        path: '/api/search',
        query: { q: query },
        tenantId: this.props.tenantId,
      }));
  }
}
```

5. In the backend, keep using the existing multi-tenant HTTP isolation: every
   proxied tool request must include `x-oracle-tenant-id`, and backend routes
   must scope reads/writes by that tenant.
6. Store secrets with `wrangler secret put`, not in `wrangler.jsonc`:

```bash
cd workers/mcp
npx wrangler secret put ARRA_API_TOKEN
```

For local previews, use a test tenant and a non-production backend URL. Do not
let demo OAuth clients reach production data until tenant mapping and audit logs
are verified.

## Manual Wrangler deploy fallback

Use this when the button is not ready or you need to test a branch preview:

```bash
npm install
npx wrangler login
npx wrangler deploy --config wrangler.jsonc
```

If the worker config lands under a subdirectory, run the same commands from that
directory or pass the subdirectory's config path:

```bash
npx wrangler deploy --config workers/oracle-mcp/wrangler.toml
```

After deploy, write down the endpoint:

```text
https://<worker-name>.<account>.workers.dev/mcp
```

Do not validate `/mcp` by opening it in a browser; it expects MCP protocol
messages. Use MCP Inspector or a real client.

## Smoke test with MCP Inspector

```bash
npx @modelcontextprotocol/inspector@latest
```

In the inspector UI, connect to:

```text
https://<worker-name>.<account>.workers.dev/mcp
```

Then select **List Tools**. If OAuth/Access is enabled, complete the auth flow
and reconnect.

## Client connection: Claude Desktop + mcp-remote

Claude Desktop can connect through the `mcp-remote` local proxy. Open Claude
Desktop settings, edit the Developer MCP config, and add:

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

Save and restart Claude Desktop. If the Worker requires OAuth/Access,
`mcp-remote` opens the browser authorization flow; sign in, grant access, and
then reconnect if Claude does not list tools immediately.

For token-protected private previews before OAuth lands, pass a temporary header
instead of making the endpoint public:

```json
{
  "mcpServers": {
    "arra-oracle-cloudflare-preview": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://<worker-name>.<account>.workers.dev/mcp",
        "--header",
        "Authorization: Bearer <preview-token>"
      ]
    }
  }
}
```

If your Claude client supports remote MCP URLs directly, use the same `/mcp` URL
as the server URL. OAuth-capable clients should redirect to the Worker
authorization endpoints and store their own MCP access token; stdio-only clients
should keep using `mcp-remote`.

## Troubleshooting

- **Deploy button fails early:** confirm the repo is public and the button points
  to the directory containing `package.json` and Wrangler config.
- **Build cannot find bindings:** ensure each D1/KV/R2/Vectorize/Durable Object
  binding has default names/IDs in Wrangler config for Cloudflare to provision.
- **`/mcp` returns a browser error:** use MCP Inspector or `mcp-remote`; direct
  browser navigation is not a valid MCP request.
- **Claude shows no tools:** verify the deployed URL ends in `/mcp`, restart the
  client, and run MCP Inspector to separate client config from server issues.
- **Backend proxy tools fail:** check `ORACLE_HTTP_URL`, `ARRA_API_TOKEN`, and
  tenant headers against the upstream Arra Oracle HTTP server.

## References

- Cloudflare Deploy buttons: <https://developers.cloudflare.com/workers/platform/deploy-buttons/>
- Cloudflare remote MCP guide: <https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/>
- Cloudflare `McpAgent` API: <https://developers.cloudflare.com/agents/model-context-protocol/apis/agent-api/>
- Cloudflare MCP authorization: <https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/>
- Testing remote MCP clients: <https://developers.cloudflare.com/agents/model-context-protocol/guides/test-remote-mcp-server/>
- `mcp-remote` package: <https://www.npmjs.com/package/mcp-remote>
