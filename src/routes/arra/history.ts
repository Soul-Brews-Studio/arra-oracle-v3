/** GET /api/arra/history[/:sha[/note]] — vault time travel for the hub UI (#3110). Owner only, read-only. */
import { Elysia, t } from 'elysia';
import { noteAt, vaultAt, vaultHistory } from '../../arra/history.ts';
import { failed } from './guard.ts';

export function createArraHistoryRoutes() {
  return new Elysia()
    .get('/history', ({ query, set }) => {
      try { return { ok: true, ...vaultHistory(query.limit ? Number(query.limit) : 100) }; }
      catch (error) { return failed(set, error); }
    }, { query: t.Object({ limit: t.Optional(t.String()) }), detail: { tags: ['arra'], summary: 'Vault timeline: every commit (init, share, retire) with its file changes and snapshots' } })
    .get('/history/:sha', ({ params, set }) => {
      try { return { ok: true, ...vaultAt(params.sha) }; }
      catch (error) { return failed(set, error, 404); }
    }, { detail: { tags: ['arra'], summary: 'The vault as it was at one commit: its notes, and what changed since' } })
    .get('/history/:sha/note', ({ params, query, set }) => {
      try { return { ok: true, sha: params.sha, path: query.path, markdown: noteAt(params.sha, query.path) }; }
      catch (error) { return failed(set, error, 404); }
    }, { query: t.Object({ path: t.String({ minLength: 1 }) }), detail: { tags: ['arra'], summary: 'One note as it was at one commit' } });
}
