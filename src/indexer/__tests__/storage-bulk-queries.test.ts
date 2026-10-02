import { expect, spyOn, test } from 'bun:test';
import { createDatabase } from '../../db/index.ts';
import { storeDocuments } from '../storage.ts';
import { document, seed } from './storage-bulk-fixture.ts';

test('bulk storage scans pointers once and reads/upserts each affected key once', async () => {
  const conn = createDatabase(':memory:');
  await seed(conn, 'default');
  // Observe every Drizzle wrapper on this connection, including the legacy raw-sqlite path.
  const prepare = spyOn(conn.sqlite, 'prepare');
  try {
    const documents = Array.from({ length: 24 }, (_, i) => document(`batch-${i}`));
    documents.push(document('changed'), document('changed', { concepts: ['shared', 'final'] }));
    await storeDocuments(conn.sqlite, conn.db, null, null, documents, { tenantId: 'default' });
    const queries = prepare.mock.calls.map(([query]) => query.replaceAll('"', '').toLowerCase());
    const pointerQueries = queries.filter((query) => query.includes('oracle_pointer_index'));
    const scans = pointerQueries.filter((query) => query.startsWith('select ') && query.includes('tenant_id = ?'));
    expect(scans).toHaveLength(1);

    const reads = pointerQueries.filter((query) => query.startsWith('select ') && query.includes('where oracle_pointer_index.id = ?'));
    const upserts = pointerQueries.filter((query) => query.startsWith('insert into '));
    const { n } = conn.sqlite.prepare('SELECT count(*) AS n FROM oracle_pointer_index WHERE tenant_id = ?')
      .get('default') as { n: number };
    // 'remove-me' belongs only to an untouched document, so it is never read/upserted.
    const untouched = conn.sqlite.prepare('SELECT count(*) AS n FROM oracle_pointer_index WHERE key = ?')
      .get('remove-me') as { n: number };
    expect(reads).toHaveLength(n - untouched.n);
    expect(upserts).toHaveLength(reads.length);

    const inventories = queries.filter((query) => query === 'select rowid, id from oracle_fts');
    expect(inventories).toHaveLength(1);
    const ftsDeletes = queries.filter((query) => query.startsWith('delete from oracle_fts'));
    expect(ftsDeletes).toHaveLength(3); // Two old duplicates and the first replacement.
    expect(ftsDeletes.every((query) => query === 'delete from oracle_fts where rowid = ?')).toBe(true);
  } finally {
    prepare.mockRestore();
    conn.storage.close();
  }
});
