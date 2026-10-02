import { expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { createDatabase } from '../../db/create.ts';
import { oracleContent } from '../../db/content-schema.ts';
import { storeDocuments } from '../../indexer/storage.ts';
import { document } from '../../indexer/__tests__/storage-bulk-fixture.ts';
import { mapFtsResults, searchFts } from '../../tools/search/fts.ts';
import { sanitizeFtsQuery } from '../../tools/search/helpers.ts';
import { hydratePointerDocs } from '../pointer-hydrate.ts';
import { replaceFts } from '../fts-write.ts';
import type { ToolContext } from '../../tools/types.ts';

test('search, pointer hydration and daemon text reads retain exact original chunk bytes', async () => {
  const conn = createDatabase(':memory:');
  const content = '# ภาษาไทย\r\n\nบัญชียิ้ม  โปรแกรม\tAPI Cafe\u0301';
  try {
    const vectorTexts: string[] = [];
    const vector = { name: 'test', addDocuments: async (docs: { document: string }[]) => {
      vectorTexts.push(...docs.map((doc) => doc.document));
    } };
    await storeDocuments(conn.sqlite, conn.db, vector as any, null, [document('original', { content })]);
    const ctx = conn as unknown as ToolContext;
    const hits = searchFts(ctx, sanitizeFtsQuery('ภาษาไทย'), 'all', 10, null);
    expect(mapFtsResults(hits)[0].content).toBe(content);
    const pointers = hydratePointerDocs(conn.db, new Map([['original', { score: 1, matches: [] }]]), {
      tenantId: 'default', limit: 1,
    });
    expect(pointers[0].content).toBe(content);
    // Same Drizzle read used by the daemon's getDocText.
    expect(conn.db.select({ content: oracleContent.content }).from(oracleContent)
      .where(eq(oracleContent.id, 'original')).get()?.content).toBe(content);
    expect(vectorTexts).toEqual([content]);
    expect(conn.sqlite.query('SELECT content FROM oracle_fts WHERE id = ?').get('original'))
      .not.toEqual({ content });
    const replacement = '  ยิ้มภาษาไทย\n';
    replaceFts(conn.db, 'original', replacement, '');
    expect(searchFts(ctx, sanitizeFtsQuery('ภาษาไทย'), 'all', 10, null)[0].content).toBe(replacement);
    conn.sqlite.query('DELETE FROM oracle_documents WHERE id = ?').run('original');
    expect(conn.sqlite.query('SELECT * FROM oracle_document_content').all()).toEqual([]);
  } finally { conn.storage.close(); }
});

test('migration is idempotent and legacy unsegmented rows remain readable', async () => {
  const conn = createDatabase(':memory:');
  try {
    const migration = await Bun.file(new URL('../../db/migrations/0042_fts_original_content.sql', import.meta.url)).text();
    conn.sqlite.exec(migration);
    conn.sqlite.exec(migration);
    const original = 'ข้อความเก่า\n  ภาษาไทย';
    conn.sqlite.query('INSERT INTO oracle_fts(id, content, concepts) VALUES (?, ?, ?)').run('old', original, '');
    expect(conn.sqlite.query('SELECT content FROM oracle_content WHERE id = ?').get('old')).toEqual({ content: original });
  } finally { conn.storage.close(); }
});
