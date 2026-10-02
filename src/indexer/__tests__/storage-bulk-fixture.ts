import type { Database } from 'bun:sqlite';
import type { DatabaseConnection } from '../../db/create.ts';
import type { OracleDocument } from '../../types.ts';
import { tenants } from '../../db/schema.ts';
import { replaceDocumentPointers } from '../../search/pointer-index.ts';
import { storeDocumentsLegacy } from './storage-legacy.ts';

const stamp = Date.parse('2026-06-05T12:00:00.000Z');

export function document(id: string, overrides: Partial<OracleDocument> = {}): OracleDocument {
  return {
    id, type: 'learning', source_file: `ψ/memory/learnings/${id}.md`,
    content: 'CORS on Cloudflare Workers', concepts: ['shared', 'Edge Runtime'],
    created_at: stamp, updated_at: stamp, ...overrides,
  };
}

export async function seed(conn: DatabaseConnection, tenantId: string): Promise<void> {
  for (const id of new Set([tenantId, tenantId.trim() || 'default', 'other'])) {
    conn.db.insert(tenants).values({ id, createdAt: stamp, updatedAt: stamp }).onConflictDoNothing().run();
  }
  await storeDocumentsLegacy(conn.sqlite, conn.db, null, null, [
    document('preserved'),
    document('changed', { concepts: ['obsolete', 'shared'] }),
    document('emptied', { concepts: ['remove-me'] }),
  ], { tenantId });
  // Both preserved and replaced ids start with duplicate FTS rows.
  for (const id of ['preserved', 'changed']) {
    conn.sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)')
      .run(id, 'duplicate old text', 'old');
  }
  replaceDocumentPointers(conn.sqlite, {
    documentId: 'changed', tenantId: 'other', content: 'Other Tenant', concepts: ['shared'],
  });
}

export function replacements(): OracleDocument[] {
  return [
    document('changed', { concepts: ['transient'] }),
    document('new', { concepts: ['transient-new'] }),
    document('emptied', { concepts: ['also-transient'] }),
    document('changed', {
      content: 'API final revision', concepts: ['shared', 'final'],
      updated_at: Date.parse('2027-01-02T00:00:00Z'),
    }),
    document('new', { content: 'final new text', concepts: ['shared'], updated_at: 0 }),
    document('emptied', { content: '', concepts: [], created_at: 0, updated_at: 0 }),
  ];
}

export function snapshot(sqlite: Database) {
  return {
    fts: sqlite.prepare('SELECT id, content, concepts FROM oracle_fts ORDER BY id, content, concepts').all(),
    pointers: sqlite.prepare(`
      SELECT id, tenant_id, kind, key, doc_ids FROM oracle_pointer_index ORDER BY id
    `).all(),
    // Ignore wall-clock indexing/pointer timestamps; compare persisted content and memberships.
    documents: sqlite.prepare(`
      SELECT id, tenant_id, type, source_file, concepts, created_at, updated_at, project, created_by
      FROM oracle_documents ORDER BY id
    `).all(),
  };
}
