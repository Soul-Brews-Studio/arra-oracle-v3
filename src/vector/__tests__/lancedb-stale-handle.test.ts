/**
 * Regression for #987:
 * A long-lived LanceDB Table handle must not silently corrupt storage after
 * another process rebuilds the collection. The adapter now checks out the
 * latest table manifest before reads/writes, and index-model uses in-place
 * replacement instead of drop/recreate.
 */

import { describe, it, expect } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { LanceDBAdapter } from '../adapters/lancedb.ts';
import type { EmbeddingProvider, EmbedType, VectorDocument } from '../types.ts';

class DeterministicEmbedder implements EmbeddingProvider {
  readonly name = 'deterministic';
  readonly dimensions = 4;

  async embed(texts: string[], _type?: EmbedType): Promise<number[][]> {
    return texts.map((text) => {
      const seed = Array.from(text).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 10;
      return [seed + 0.1, seed + 0.2, seed + 0.3, seed + 0.4];
    });
  }
}

const doc = (id: string, document = id): VectorDocument => ({
  id,
  document,
  metadata: { type: 'test' },
});

describe('LanceDB stale-handle safety (#987)', () => {
  it('keeps a long-lived handle safe after another process drop/recreates the table', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-lancedb-stale-'));
    const collection = 'stale_handle_regression';
    const live = new LanceDBAdapter(collection, tmpDir, new DeterministicEmbedder());
    const reindexer = new LanceDBAdapter(collection, tmpDir, new DeterministicEmbedder());
    const fresh = new LanceDBAdapter(collection, tmpDir, new DeterministicEmbedder());

    try {
      await live.connect();
      await live.ensureCollection();
      await live.addDocuments([doc('before-reindex')]);

      // Simulate the pre-fix destructive index-model behavior from a second
      // process. This used to leave `live` holding a stale table handle; its
      // next add returned OK but fresh readers crashed on missing Lance files.
      await reindexer.connect();
      await reindexer.deleteCollection();
      await reindexer.ensureCollection();
      await reindexer.addDocuments([doc('from-reindex')]);

      await live.addDocuments([doc('after-stale-handle')]);

      await fresh.connect();
      await fresh.ensureCollection();
      const stats = await fresh.getStats();
      const result = await fresh.query('reindex', 10);

      expect(stats.count).toBe(2);
      expect(result.ids).toContain('from-reindex');
      expect(result.ids).toContain('after-stale-handle');
    } finally {
      try { await live.close(); } catch {}
      try { await reindexer.close(); } catch {}
      try { await fresh.close(); } catch {}
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('replaceDocuments clears/replaces rows without dropCollection', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-lancedb-replace-'));
    const collection = 'replace_documents_regression';
    const adapter = new LanceDBAdapter(collection, tmpDir, new DeterministicEmbedder());

    try {
      await adapter.connect();
      await adapter.ensureCollection();
      await adapter.addDocuments([doc('old-1'), doc('old-2')]);
      await adapter.replaceDocuments([doc('new-1')]);

      const stats = await adapter.getStats();
      const result = await adapter.query('new', 10);

      expect(stats.count).toBe(1);
      expect(result.ids).toEqual(['new-1']);
    } finally {
      try { await adapter.close(); } catch {}
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('deleteDocuments removes selected rows without dropping the collection', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-lancedb-delete-docs-'));
    const adapter = new LanceDBAdapter('delete_documents_regression', tmpDir, new DeterministicEmbedder());

    try {
      await adapter.connect();
      await adapter.ensureCollection();
      await adapter.addDocuments([doc('keep'), doc('drop')]);
      await adapter.deleteDocuments(['drop']);

      const stats = await adapter.getStats();
      const result = await adapter.query('keep', 10);

      expect(stats.count).toBe(1);
      expect(result.ids).toEqual(['keep']);
    } finally {
      try { await adapter.close(); } catch {}
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
