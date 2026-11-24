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

export const arraVaultToolDef = {
  name: 'oracle_vault',
  description: 'Vault work (arra_vault). action=share: write one note (id, file or text) into an org vault as .md and commit (vault = name or hub:<name>). action=sync: pull connected vaults / joined hubs and index them as hub:<name>. action=search: results grouped by source (self, hub:<name>), scores comparable only within a group; q may start with self: or shared:. action=read: open one document by id. action=snapshot_create | snapshot_push (dest) | snapshot_pull (src) | snapshot_list: manual vector snapshots keyed by model + vault commit. Same as arra share/sync/snapshot and POST /api/arra/*.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['share', 'sync', 'search', 'read', 'snapshot_create', 'snapshot_push', 'snapshot_pull', 'snapshot_list'] },
      q: { type: 'string', description: 'search: query, results grouped by source; prefix self: or shared: to narrow' },
      limit: { type: 'number', description: 'search: results per group (default 10)' },
      id: { type: 'string', description: 'share: document id from this arra; read: id to open' },
      file: { type: 'string', description: 'share: markdown file path' },
      text: { type: 'string', description: 'share: raw note text' },
      title: { type: 'string' },
      vault: { type: 'string', description: 'vault name, or hub:<name> for a joined hub' },
      dest: { type: 'string', description: 'snapshot_push: folder, or hub:<name>' },
      src: { type: 'string', description: 'snapshot_pull: folder, .tar.zst file, or hub:<name>' },
    },
    required: ['action'],
  },
};

export async function handleArraVault(input: unknown): Promise<ToolResponse> {
  return callArraRoute('POST', '/api/arra/vault', input ?? {});
}

export const arraHubToolDef = {
  name: 'oracle_hub',
  description: 'Hub door (arra_hub). As a hub: action=invite (for 15m|1h|7d|forever, label) → one-use code; action=nodes; action=revoke (id, why) → token stops + RETIRED.md row. As a node: action=join (url, code) → per-node token; action=hubs; action=leave (name); action=discover → hubs on the tailnet. action=retire (thing, successor, why) → RETIRED.md row. Same as arra hub/join/hubs/discover/retire and /api/arra/*.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['invite', 'nodes', 'revoke', 'join', 'hubs', 'leave', 'discover', 'retire'] },
      for: { type: 'string', description: 'invite: how long the joined node lasts (15m, 1h, 7d, forever)' },
      label: { type: 'string', description: 'invite/join: node label' },
      id: { type: 'string', description: 'revoke: node id' },
      url: { type: 'string', description: 'join: hub url (tailnet or LAN)' },
      code: { type: 'string', description: 'join: invite code' },
      name: { type: 'string', description: 'leave: hub name' },
      thing: { type: 'string', description: 'retire: what ceases' },
      successor: { type: 'string', description: 'retire/revoke: what replaces it, or "nothing"' },
      why: { type: 'string', description: 'retire/revoke: reason' },
    },
    required: ['action'],
  },
};

export async function handleArraHub(input: unknown): Promise<ToolResponse> {
  return callArraRoute('POST', '/api/arra/hub', input ?? {});
}
