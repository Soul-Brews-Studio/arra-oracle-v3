import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { connect } from '@lancedb/lancedb';
import { createDatabase } from '../../db/index.ts';
import { LanceDBAdapter } from '../../vector/adapters/lancedb.ts';
import type { EmbeddingProvider } from '../../vector/types.ts';
import { handleSearch } from '../search.ts';
import type { ToolContext } from '../types.ts';

const TARGET = 'learning_2026-08-02_exit-loop-playbook-automation-ca';
const COLLECTION = 'oracle_knowledge_bge_m3';
const QUERIES = ['exit-loop playbook', 'บังคับปลายทางให้ automation capture'];
const goldenRoot = process.env.ORACLE_GOLDEN_DATA_DIR?.trim();
const goldenTest = goldenRoot ? test : test.skip;

function assertTempSnapshot(root: string): void {
  const resolvedRoot = fs.realpathSync(root);
  const resolvedTmp = fs.realpathSync(os.tmpdir());
  expect(resolvedRoot.startsWith(`${resolvedTmp}${path.sep}`)).toBe(true);
  expect(fs.realpathSync(process.env.ORACLE_DB_PATH || '')).toBe(path.join(resolvedRoot, 'oracle.db'));
  expect(fs.realpathSync(process.env.ORACLE_VECTOR_DB_PATH || '')).toBe(path.join(resolvedRoot, 'lancedb'));
}

function parse(response: { content: Array<{ text: string }> }) {
  return JSON.parse(response.content[0].text);
}

goldenTest('temp snapshot keeps the exit-loop target top-5 for English and Thai queries', async () => {
  const root = goldenRoot as string;
  assertTempSnapshot(root);
  const dbPath = path.join(root, 'oracle.db');
  const lancePath = path.join(root, 'lancedb');
  const connection = createDatabase(dbPath);
  const lance = await connect(lancePath);
  const table = await lance.openTable(COLLECTION);
  const targetRows = await table.query().where(`id = '${TARGET}'`).limit(1).toArray();
  expect(targetRows).toHaveLength(1);
  const targetVector = Array.from(targetRows[0].vector, Number);

  // The copied target vector makes embedding deterministic. FTS still consumes each real query,
  // while Lance and the handler exercise the real 5.5k-row cosine/fusion ordering without Ollama.
  const embedder: EmbeddingProvider = {
    name: 'golden-target-vector',
    dimensions: targetVector.length,
    embed: async (texts) => texts.map(() => targetVector),
  };
  const vectorStore = new LanceDBAdapter(COLLECTION, lancePath, embedder);
  await vectorStore.connect();
  await vectorStore.ensureCollection();
  process.env.ORACLE_VECTOR_ENABLED = '1';
  delete process.env.ORACLE_RERANKER_URL;

  const ctx: ToolContext & { entityLinkSearch: () => Promise<never[]> } = {
    db: connection.db,
    sqlite: connection.sqlite,
    repoRoot: root,
    vectorStore,
    vectorStatus: 'connected',
    version: 'golden-snapshot',
    entityLinkSearch: async () => [],
  };

  try {
    for (const query of QUERIES) {
      const body = parse(await handleSearch(ctx, { query, mode: 'hybrid', limit: 10 }));
      const position = body.results.findIndex((result: { id: string }) => result.id === TARGET);
      expect(position, `${query}: target position`).toBeGreaterThanOrEqual(0);
      expect(position, `${query}: target position`).toBeLessThan(5);
    }
  } finally {
    await vectorStore.close();
    table.close?.();
    connection.storage.close();
  }
});
