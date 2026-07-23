/**
 * Bearer-token guard for the Oracle HTTP API and the remote MCP endpoint.
 *
 * Every `/api/*` request (and the `/mcp` remote MCP Streamable HTTP route —
 * see src/http/mcp-route.ts) must carry `Authorization: Bearer
 * <ARRA_API_TOKEN>` matching the server-side `ARRA_API_TOKEN` env var (same
 * name the client side already uses — see oracleApiHeaders() in
 * src/index.ts). Missing or mismatched token → 401, rejected in an Elysia
 * `onRequest` hook, i.e. before any route handler runs.
 *
 * If `ARRA_API_TOKEN` is unset on the server, this guard is a no-op — auth
 * is disabled. That's only safe because src/server.ts binds to loopback
 * (127.0.0.1) instead of 0.0.0.0 whenever no token is configured, so an
 * un-authed server can never be reached over the network. See server.ts.
 */
import { Elysia } from 'elysia';

function unauthorized(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function apiAuthGuard(
  getToken: () => string | undefined = () => process.env.ARRA_API_TOKEN,
) {
  return new Elysia().onRequest(({ request }) => {
    const pathname = new URL(request.url).pathname;
    if (!pathname.startsWith('/api') && pathname !== '/mcp') return;
    if (request.method === 'OPTIONS') return; // CORS/PNA preflight — no auth to check

    const token = getToken()?.trim();
    if (!token) return; // no ARRA_API_TOKEN configured — local-dev-only, loopback bind

    const header = request.headers.get('authorization') ?? '';
    if (header !== `Bearer ${token}`) {
      return unauthorized('Unauthorized: missing or invalid Authorization: Bearer <token> header');
    }
  });
}
