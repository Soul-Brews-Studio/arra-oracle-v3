/**
 * /api/federation/* on a hub — the door other nodes use (#3110 step 4).
 *
 *   GET  /hub                  name + counts, for `arra discover` (private address, no token)
 *   POST /join                 one-use code → node token (private address, no token)
 *   POST /share                commit a note into the hub vault          ┐
 *   GET  /vault                the vault's markdown + commit, for sync   │ private address
 *   GET  /search?q=            shared rows only: ids, titles, scores     │ + live node token
 *   GET  /doc/:id              one shared document                       │
 *   GET|PUT /snapshots/:file   manual vector snapshots                   ┘
 *
 * A hub never serves its own private rows: search and doc only see `hub:<name>` sources.
 */

import { Elysia, t } from 'elysia';
import fs from 'fs';
import path from 'path';
import { sqlite } from '../../db/index.ts';
import { authenticateNode, HubAuthError, hubName, listNodes, redeemInvite } from '../../arra/hub.ts';
import { peerIp } from '../../arra/net.ts';
import { recordKnock } from '../../arra/door-log.ts';
import { groupedSearch, readLocal } from '../../arra/search.ts';
import { snapshotDir } from '../../arra/snapshot.ts';
import { readConfig } from '../../arra/state.ts';
import { headSha } from '../../arra/git.ts';
import { readVaultFiles } from '../../arra/vault-index.ts';
import { commitNote, noteMarkdown, syncVault } from '../../arra/vault.ts';
import { bearerToken, denied, failed, isPrivateRequest } from '../arra/guard.ts';

const SNAPSHOT_FILE = /^lancedb-[a-z0-9.-]+-[0-9a-f]{7,40}\.tar\.zst$/;

function hubVault() {
  const config = readConfig();
  const vault = config?.vaults[0];
  if (!config?.hub || !vault) throw new Error('hub has no vault: arra init --hub --name <n> --vault <path>');
  return { name: config.hub.name, vault };
}

function nodeOr401(request: Request, set: { status?: unknown }) {
  try {
    return { node: authenticateNode(bearerToken(request), peerIp(request)) };
  } catch (error) {
    if (error instanceof HubAuthError) {
      recordKnock(error.status === 401 ? 'stranger' : 'refused', error.nodeId);
      return { error: denied(set, error.status, error.message) };
    }
    throw error;
  }
}

export function createHubRoutes() {
  return new Elysia({ prefix: '/api/federation' })
    .onBeforeHandle(({ request, set }) => {
      if (!isPrivateRequest(request)) {
        recordKnock('outside');
        return denied(set, 403, 'hub door is open to tailnet and LAN addresses only');
      }
    })
    .get('/hub', ({ set }) => {
      try {
        const nodes = listNodes();
        const { name, vault } = hubVault();
        return { ok: true, hub: name, sha: headSha(vault.path), nodes: nodes.filter((n) => n.state === 'active').length };
      } catch (error) { return failed(set, error, 404); }
    }, { detail: { tags: ['federation'], summary: 'Hub name and active node count (no token)' } })
    .post('/join', ({ body, request, set }) => {
      try { return { ok: true, ...redeemInvite(body, peerIp(request)) }; }
      catch (error) {
        if (!(error instanceof HubAuthError)) return failed(set, error);
        recordKnock('stranger');
        return denied(set, error.status, error.message);
      }
    }, { body: t.Object({ code: t.String(), label: t.Optional(t.String()), url: t.Optional(t.String()) }), detail: { tags: ['federation'], summary: 'Redeem a one-use invite code for a node token' } })
    .post('/share', ({ body, request, set }) => {
      const auth = nodeOr401(request, set);
      if ('error' in auth) return auth.error;
      try {
        const { vault } = hubVault();
        const note = { title: body.title?.trim() || body.text.split('\n')[0].replace(/^#+\s*/, '').slice(0, 80), body: body.text.trim(), concepts: body.concepts ?? [], originId: null };
        const shared = commitNote(vault, note.title, noteMarkdown(note, auth.node.label), auth.node.label);
        syncVault(sqlite, vault);
        return { ok: true, shared };
      } catch (error) { return failed(set, error); }
    }, { body: t.Object({ text: t.String({ minLength: 1 }), title: t.Optional(t.String()), concepts: t.Optional(t.Array(t.String())) }), detail: { tags: ['federation'], summary: 'Commit a note from a joined node into the hub vault' } })
    .get('/vault', ({ request, set }) => {
      const auth = nodeOr401(request, set);
      if ('error' in auth) return auth.error;
      const { name, vault } = hubVault();
      return { ok: true, name, sha: headSha(vault.path), files: readVaultFiles(vault.path) };
    }, { detail: { tags: ['federation'], summary: 'The hub vault markdown + commit, for arra sync' } })
    .get('/search', async ({ query, request, set }) => {
      const auth = nodeOr401(request, set);
      if ('error' in auth) return auth.error;
      const r = await groupedSearch(sqlite, `shared:${query.q}`, query.limit ? Number(query.limit) : 10);
      return { ok: true, hub: hubName(), query: r.query, groups: r.groups.map((g) => ({ source: g.source, ranking: g.ranking, results: g.results.map(({ snippet: _s, ...hit }) => hit) })) };
    }, { query: t.Object({ q: t.String({ minLength: 1 }), limit: t.Optional(t.String()) }), detail: { tags: ['federation'], summary: 'Search shared rows: ids, titles, scores (no bodies)' } })
    .get('/doc/:id', ({ params, request, set }) => {
      const auth = nodeOr401(request, set);
      if ('error' in auth) return auth.error;
      const doc = readLocal(sqlite, decodeURIComponent(params.id));
      if (!doc || doc.source === 'self') return failed(set, `no shared document ${params.id}`, 404);
      return { ok: true, ...doc };
    }, { detail: { tags: ['federation'], summary: 'One shared document (never a private row)' } })
    .get('/snapshots', ({ request, set }) => {
      const auth = nodeOr401(request, set);
      if ('error' in auth) return auth.error;
      const dir = snapshotDir();
      return { ok: true, snapshots: fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => SNAPSHOT_FILE.test(f)).sort() : [] };
    }, { detail: { tags: ['federation'], summary: 'Snapshots this hub holds' } })
    .get('/snapshots/:file', ({ params, request, set }) => {
      const auth = nodeOr401(request, set);
      if ('error' in auth) return auth.error;
      const file = path.join(snapshotDir(), params.file);
      if (!SNAPSHOT_FILE.test(params.file) || !fs.existsSync(file)) return failed(set, `no snapshot ${params.file}`, 404);
      return new Response(Bun.file(file), { headers: { 'content-type': 'application/zstd' } });
    }, { detail: { tags: ['federation'], summary: 'Download one snapshot' } })
    .put('/snapshots/:file', async ({ params, request, set }) => {
      const auth = nodeOr401(request, set);
      if ('error' in auth) return auth.error;
      if (!SNAPSHOT_FILE.test(params.file)) return failed(set, 'snapshot name must be lancedb-<model>-<sha>.tar.zst');
      fs.mkdirSync(snapshotDir(), { recursive: true });
      const bytes = new Uint8Array(await request.arrayBuffer());
      fs.writeFileSync(path.join(snapshotDir(), params.file), bytes);
      return { ok: true, file: params.file, bytes: bytes.length, from: auth.node.id };
    }, { parse: 'none', detail: { tags: ['federation'], summary: 'Upload one snapshot from a joined node' } });
}

export const hubRoutes = createHubRoutes();
