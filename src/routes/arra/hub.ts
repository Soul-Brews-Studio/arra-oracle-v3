/**
 * /api/arra hub work for the box owner (#3110 step 4).
 *
 * As a hub:   POST /hub/invite · GET /hub/nodes · POST /hub/revoke
 * As a node:  POST /join · GET /hubs · POST /hubs/leave · GET /discover
 * Either:     POST /retire (RETIRED.md row) · POST /hub (MCP arra_hub dispatch)
 */

import { Elysia, t } from 'elysia';
import { createInvite, listInvites, listNodes, revokeNode } from '../../arra/hub.ts';
import { joinHub, leaveHub, readFromHub } from '../../arra/hub-client.ts';
import { discoverHubs } from '../../arra/discover.ts';
import { retire } from '../../arra/retire.ts';
import { publicHub, readHubs } from '../../arra/state.ts';
import { failed } from './guard.ts';
import { setRemoteReader } from './search.ts';

// read <id> for a row this node never synced: ask the hub it names (hub:<name>:<path>).
setRemoteReader(async (id) => {
  const name = id.match(/^hub:([^:]+):/)?.[1];
  if (!name || !readHubs().some((h) => h.name === name)) return null;
  try { return await readFromHub(name, id); } catch { return null; }
});

type Args = Record<string, any>;

export async function hubAction(action: string, a: Args) {
  switch (action) {
    case 'invite': return { ok: true, invite: createInvite({ grant: a.for ?? a.grant, label: a.label }) };
    case 'nodes': return { ok: true, nodes: listNodes(), invites: listInvites() };
    case 'revoke':
      if (!a.id) throw new Error('revoke needs the node id (arra hub nodes)');
      return { ok: true, ...revokeNode(String(a.id), { why: a.why, successor: a.successor }) };
    case 'join':
      if (!a.url || !a.code) throw new Error('join needs url and code');
      return { ok: true, joined: await joinHub({ url: String(a.url), code: String(a.code), label: a.label }) };
    case 'hubs': return { ok: true, hubs: readHubs().map(publicHub) };
    case 'leave':
      if (!a.name) throw new Error('leave needs the hub name');
      return { ok: true, ...leaveHub(String(a.name)) };
    case 'discover': return { ok: true, ...(await discoverHubs({ port: a.port ? Number(a.port) : undefined, hosts: a.hosts })) };
    case 'retire':
      return { ok: true, retired: retire({ thing: String(a.thing ?? ''), successor: String(a.successor ?? ''), why: String(a.why ?? ''), back: a.back, vault: a.vault }) };
    default: throw new Error(`unknown arra_hub action: ${action} (invite, nodes, revoke, join, hubs, leave, discover, retire)`);
  }
}

const run = (action: string) => async ({ body, query, set }: { body?: unknown; query?: Args; set: { status?: unknown } }) => {
  try { return await hubAction(action, { ...(query ?? {}), ...((body as Args) ?? {}) }); } catch (error) { return failed(set, error); }
};

export function createArraHubRoutes() {
  return new Elysia()
    .post('/hub/invite', run('invite'), { body: t.Optional(t.Object({ for: t.Optional(t.String()), label: t.Optional(t.String()) })), detail: { tags: ['arra'], summary: 'Hub: one-use invite code (10 min); the node lasts --for' } })
    .get('/hub/nodes', run('nodes'), { detail: { tags: ['arra'], summary: 'Hub: joined nodes (expiry, last seen, calls) and invites' } })
    .post('/hub/revoke', run('revoke'), { body: t.Object({ id: t.String(), why: t.Optional(t.String()), successor: t.Optional(t.String()) }), detail: { tags: ['arra'], summary: 'Hub: stop a node token now + RETIRED.md row' } })
    .post('/join', run('join'), { body: t.Object({ url: t.String(), code: t.String(), label: t.Optional(t.String()) }), detail: { tags: ['arra'], summary: 'Node: join a hub with an invite code' } })
    .get('/hubs', run('hubs'), { detail: { tags: ['arra'], summary: 'Node: hubs joined (no tokens shown)' } })
    .post('/hubs/leave', run('leave'), { body: t.Object({ name: t.String() }), detail: { tags: ['arra'], summary: 'Node: drop a hub token locally' } })
    .get('/discover', run('discover'), { query: t.Object({ port: t.Optional(t.String()), hosts: t.Optional(t.String()) }), detail: { tags: ['arra'], summary: 'Find hubs on the tailnet' } })
    .post('/retire', run('retire'), { body: t.Object({ thing: t.String(), successor: t.String(), why: t.String(), back: t.Optional(t.String()), vault: t.Optional(t.String()) }), detail: { tags: ['arra'], summary: 'Cease by hand: RETIRED.md row in the vault' } })
    .post('/hub', async ({ body, set }) => {
      const { action, ...args } = (body ?? {}) as Args;
      try { return await hubAction(String(action), args); } catch (error) { return failed(set, error); }
    }, { detail: { tags: ['arra'], summary: 'MCP arra_hub dispatch' } });
}
