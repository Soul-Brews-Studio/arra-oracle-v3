/**
 * GET /api/reflect — oracle's current self-reflection.
 */

import { Elysia } from 'elysia';
import { isDbLockError, sqlite } from '../../db/index.ts';
import { parseConcepts } from '../../search/query.ts';
import { handleTenantReflect } from './tenant-search.ts';

type ReflectRow = { id: string; type: string; source_file: string; concepts: string | null; content: string | null };

function randomOffset(total: number): number {
  return Math.floor(Math.random() * total);
}

function handleGlobalReflect(): Record<string, unknown> {
  try {
    const count = sqlite.prepare(`
      SELECT COUNT(*) as total
      FROM oracle_documents
      WHERE type IN ('principle', 'learning')
    `).get() as { total: number } | undefined;
    const total = Number(count?.total ?? 0);
    if (total < 1) return { error: 'No documents found', fts_status: 'empty' };

    const doc = sqlite.prepare(`
      SELECT id, type, source_file, concepts
      FROM oracle_documents
      WHERE type IN ('principle', 'learning')
      LIMIT 1 OFFSET ?
    `).get(randomOffset(total)) as { id: string; type: string; source_file: string; concepts: string | null } | undefined;
    if (!doc) return { error: 'No documents found', fts_status: 'empty' };
    const fts = sqlite.prepare(`SELECT content FROM oracle_fts WHERE id = ?`).get(doc.id) as { content: string } | undefined;
    const row: ReflectRow = { ...doc, content: fts?.content ?? null };

    if (!row) return { error: 'No documents found', fts_status: 'empty' };
    const base = {
      id: row.id,
      type: row.type,
      source_file: row.source_file,
      concepts: parseConcepts(row.concepts),
    };
    if (!row.content) {
      return { ...base, error: 'Document content not found in FTS index', fts_status: 'missing' };
    }
    return { ...base, content: row.content, fts_status: 'healthy' };
  } catch (err) {
    if (isDbLockError(err)) {
      return { id: null, type: 'principle', content: 'Oracle is indexing — please wait...', source_file: null, concepts: [], indexing: true };
    }
    throw err;
  }
}

export const reflectEndpoint = new Elysia().get('/reflect', () => handleTenantReflect() ?? handleGlobalReflect(), {
  detail: {
    tags: ['search'],
    menu: { group: 'main', path: '/playground', order: 30 },
    summary: 'Oracle self-reflection snapshot',
  },
});
