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

    const row = sqlite.prepare(`
      SELECT d.id, d.type, d.source_file, d.concepts, f.content
      FROM oracle_documents d
      LEFT JOIN oracle_fts f ON d.id = f.id
      WHERE d.type IN ('principle', 'learning')
      LIMIT 1 OFFSET ?
    `).get(randomOffset(total)) as ReflectRow | undefined;

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
