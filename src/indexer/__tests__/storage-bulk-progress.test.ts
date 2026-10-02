import { expect, spyOn, test } from 'bun:test';
import { createDatabase } from '../../db/index.ts';
import { storeDocuments } from '../storage.ts';
import { document } from './storage-bulk-fixture.ts';

test('storage reports each thousand chunks to stdout', async () => {
  const conn = createDatabase(':memory:');
  const log = spyOn(console, 'log').mockImplementation(() => {});
  try {
    const documents = Array.from({ length: 2001 }, (_, i) => document(`progress-${i}`));
    await storeDocuments(conn.sqlite, conn.db, null, null, documents, { tenantId: 'default' });
    expect(log.mock.calls.filter(([message]) => String(message).startsWith('stored '))).toEqual([
      ['stored 1000/2001 chunks'],
      ['stored 2000/2001 chunks'],
    ]);
    expect(conn.sqlite.prepare('SELECT count(*) AS n FROM oracle_fts').get()).toEqual({ n: 2001 });
  } finally {
    log.mockRestore();
    conn.storage.close();
  }
});
