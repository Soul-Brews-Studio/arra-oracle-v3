/**
 * /api/arra share · sync · snapshot — the vault half of #3110 (owner-only, mounted by index.ts).
 */

import { Elysia, t } from 'elysia';
import { sqlite } from '../../db/index.ts';
import { readConfig } from '../../arra/state.ts';
import { listSnapshots } from '../../arra/status.ts';
import { applySnapshot, createSnapshot, pullSnapshotFromDir, pushSnapshotToDir, snapshotDir } from '../../arra/snapshot.ts';
import { shareToVault, syncVault, type ShareInput } from '../../arra/vault.ts';
import { vectorModels } from '../../arra/models.ts';
import { failed } from './guard.ts';

export const ShareBody = t.Object({
  id: t.Optional(t.String()),
  file: t.Optional(t.String()),
  text: t.Optional(t.String()),
  title: t.Optional(t.String()),
  vault: t.Optional(t.String()),
  concepts: t.Optional(t.Array(t.String())),
});

export function syncAll(vault?: string) {
  const vaults = (readConfig()?.vaults ?? []).filter((v) => !vault || v.name === vault.replace(/^hub:/, ''));
  const models = vectorModels();
  return { ok: true, vaults: vaults.map((v) => syncVault(sqlite, v, models)) };
}

export function shareNote(body: ShareInput) {
  return { ok: true, shared: shareToVault(sqlite, body) };
}

export function snapshotAction(action: string, body: { vault?: string; dest?: string; src?: string; file?: string }) {
  if (action === 'create') return { ok: true, snapshot: createSnapshot(sqlite, { vault: body.vault }) };
  if (action === 'push') {
    if (!body.dest) throw new Error('snapshot push needs dest (a folder)');
    return { ok: true, pushed: pushSnapshotToDir(body.dest, body.file) };
  }
  if (action === 'pull') {
    if (!body.src) throw new Error('snapshot pull needs src (a folder or a .tar.zst file)');
    const result = body.src.endsWith('.tar.zst') ? applySnapshot(body.src, undefined, body.vault) : pullSnapshotFromDir(body.src, undefined, body.vault);
    return { ok: result.matched, pull: result };
  }
  if (action === 'list') return { ok: true, dir: snapshotDir(), snapshots: listSnapshots() };
  throw new Error(`unknown snapshot action: ${action} (create, push, pull, list)`);
}

const SnapshotBody = t.Object({
  vault: t.Optional(t.String()),
  dest: t.Optional(t.String()),
  src: t.Optional(t.String()),
  file: t.Optional(t.String()),
});

export function createArraVaultRoutes() {
  return new Elysia()
    .post('/share', ({ body, set }) => {
      try { return shareNote(body); } catch (error) { return failed(set, error); }
    }, { body: ShareBody, detail: { tags: ['arra'], summary: 'Write one note into an org vault as .md and commit it' } })
    .post('/sync', ({ body, set }) => {
      try { return syncAll(body?.vault); } catch (error) { return failed(set, error); }
    }, { body: t.Optional(t.Object({ vault: t.Optional(t.String()) })), detail: { tags: ['arra'], summary: 'Pull connected vaults and index them as hub:<name>' } })
    .get('/snapshots', () => snapshotAction('list', {}), { detail: { tags: ['arra'], summary: 'List local vector snapshots' } })
    .post('/snapshot/:action', ({ params, body, set }) => {
      try {
        const result = snapshotAction(params.action, body ?? {});
        if (!result.ok) set.status = 409;
        return result;
      } catch (error) { return failed(set, error); }
    }, { body: t.Optional(SnapshotBody), detail: { tags: ['arra'], summary: 'Manual vector snapshot: create, push <dest>, pull <src>' } });
}
