/** /api/arra/search (grouped by source) and /api/arra/read (one document) — #3110 step 3. */

import { Elysia, t } from 'elysia';
import { sqlite } from '../../db/index.ts';
import { groupedSearch, readLocal } from '../../arra/search.ts';
import { failed } from './guard.ts';

/** Remote fallback for ids this arra does not hold; filled in by the hub client. */
export type RemoteReader = (id: string) => Promise<Record<string, unknown> | null>;
let remoteReader: RemoteReader | null = null;
export function setRemoteReader(reader: RemoteReader | null): void { remoteReader = reader; }

export async function readDoc(id: string) {
  const local = readLocal(sqlite, id);
  if (local) return { ok: true, from: 'local', doc: local };
  const remote = remoteReader ? await remoteReader(id) : null;
  if (remote) return { ok: true, from: 'hub', doc: remote };
  throw new Error(`no document ${id} here${remoteReader ? ' or on a joined hub' : ''}`);
}

export async function searchAction(q: string, limit?: number) {
  return { ok: true, ...(await groupedSearch(sqlite, q, limit ?? 10)) };
}

export function createArraSearchRoutes() {
  return new Elysia()
    .get('/search', async ({ query, set }) => {
      try { return await searchAction(query.q, query.limit ? Number(query.limit) : undefined); } catch (error) { return failed(set, error); }
    }, {
      query: t.Object({ q: t.String({ minLength: 1 }), limit: t.Optional(t.String()) }),
      detail: { tags: ['arra'], summary: 'Search grouped by source (self, hub:<name>); prefixes self: / shared: narrow' },
    })
    .get('/read', async ({ query, set }) => {
      try { return await readDoc(query.id); } catch (error) { return failed(set, error, 404); }
    }, {
      query: t.Object({ id: t.String({ minLength: 1 }) }),
      detail: { tags: ['arra'], summary: 'Open one document by id (local copy, else the hub it came from)' },
    });
}
