import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteVecAdapter } from '../adapters/sqlite-vec.ts';

const available = (() => {
  try {
    const sqlite = new (require('bun:sqlite').Database)(':memory:');
    const extension = require('sqlite-vec');
    sqlite.loadExtension(extension.getLoadablePath());
    sqlite.close();
    return true;
  } catch { return false; }
})();

test.skipIf(!available)('selected deletion removes metadata and vectors, preserves siblings and tolerates retries', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'arra-vec-delete-'));
  const adapter = new SqliteVecAdapter('files_test', join(directory, 'vec.db'), {
    name: 'synthetic', dimensions: 2,
    async embed(texts) { return texts.map(() => [1, 0]); },
  });
  try {
    await adapter.connect();
    await adapter.addDocuments([
      { id: 'keep', document: 'kept', metadata: {} },
      { id: 'remove', document: 'obsolete', metadata: {} },
    ]);
    await adapter.deleteDocuments(['remove']);
    await adapter.deleteDocuments(['remove', 'missing']);
    await adapter.deleteDocuments([]);
    expect(await adapter.getStats()).toEqual({ count: 1 });
    expect((await adapter.queryByVector([1, 0], 10)).ids).toEqual(['keep']);
    expect((await adapter.getAllEmbeddings()).ids).toEqual(['keep']);
  } finally {
    await adapter.close();
    rmSync(directory, { recursive: true });
  }
});
