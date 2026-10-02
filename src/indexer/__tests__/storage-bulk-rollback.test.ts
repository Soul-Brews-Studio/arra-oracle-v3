import { expect, spyOn, test } from 'bun:test';
import { createDatabase } from '../../db/index.ts';
import { storeDocuments } from '../storage.ts';
import { replacements, seed, snapshot } from './storage-bulk-fixture.ts';

test('pointer batch failure rolls back metadata, FTS, original text, and earlier pointer writes', async () => {
  const conn = createDatabase(':memory:');
  await seed(conn, 'default');
  const before = snapshot(conn.sqlite);
  const originals = conn.sqlite.query('SELECT * FROM oracle_document_content').all();
  const originalPrepare = conn.sqlite.prepare.bind(conn.sqlite);
  let pointerWrites = 0;
  const prepare = spyOn(conn.sqlite, 'prepare').mockImplementation((query, ...args) => {
    if (query.startsWith('insert into "oracle_pointer_index"') && ++pointerWrites === 2) {
      throw new Error('injected batch failure');
    }
    return originalPrepare(query, ...args);
  });
  try {
    await expect(storeDocuments(conn.sqlite, conn.db, null, null, replacements(), { tenantId: 'default' }))
      .rejects.toThrow('injected batch failure');
    expect(pointerWrites).toBe(2);
    expect(snapshot(conn.sqlite)).toEqual(before);
    expect(conn.sqlite.query('SELECT * FROM oracle_document_content').all()).toEqual(originals);
  } finally {
    prepare.mockRestore();
    conn.storage.close();
  }
});
