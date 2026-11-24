/**
 * MCP door to the vault + local DB + hub (#3110): arra_status, arra_vault, arra_hub.
 *
 * Thin callers by construction. In HTTP-proxy mode the MCP server forwards these through
 * mcp-rest-map to /api/arra/*. In embedded mode the handler sends the SAME request to the
 * same Elysia routes in-process. Either way the logic that runs is the API's, so MCP, CLI,
 * skills and HTTP cannot drift apart.
 */

import type { ToolResponse } from './types.ts';

type Handle = { handle(request: Request): Promise<Response> };
let routes: Handle | null = null;
async function arraApi(): Promise<Handle> {
  routes ??= (await import('../routes/arra/index.ts')).arraRoutes;
  return routes;
}

export async function callArraRoute(method: 'GET' | 'POST', path: string, body?: unknown): Promise<ToolResponse> {
  const api = await arraApi();
  const res = await api.handle(new Request(`http://arra.local${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const text = await res.text();
  return { content: [{ type: 'text', text }], ...(res.ok ? {} : { isError: true }) };
}

export const arraStatusToolDef = {
  name: 'oracle_status',
  description: 'This arra (arra_status): data dir, documents per source (self / hub:<name>), connected vaults, hubs joined, hub mode, embedder, snapshots. Same as `arra status` and GET /api/arra/status.',
  inputSchema: { type: 'object', properties: {} },
};

export async function handleArraStatus(): Promise<ToolResponse> {
  return callArraRoute('GET', '/api/arra/status');
}
