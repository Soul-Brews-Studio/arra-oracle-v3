/** One default vector engine, and an unknown engine is an error (it used to start Chroma silently). */
import { afterEach, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createVectorStore } from '../../src/vector/factory.ts';
import { DEFAULT_SAFE_VECTOR_ENGINE } from '../../src/config/defaults.ts';
import { localVectorIndexMissingReason } from '../../src/vector/cpu-capabilities.ts';

const saved = process.env.ORACLE_VECTOR_DB;
afterEach(() => { if (saved === undefined) delete process.env.ORACLE_VECTOR_DB; else process.env.ORACLE_VECTOR_DB = saved; });

test('no type and no env: the factory uses the app default engine', () => {
  delete process.env.ORACLE_VECTOR_DB;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vdef-'));
  const store = createVectorStore({ collectionName: 'c', dataPath: path.join(dir, 'vectors.db'), embeddingProvider: 'none' as never });
  expect(store.name).toBe(DEFAULT_SAFE_VECTOR_ENGINE);
});
test('an unknown engine throws instead of falling through to Chroma', () => {
  expect(() => createVectorStore({ type: 'lanceddb' as never, collectionName: 'c' })).toThrow('unknown vector engine "lanceddb"');
});
test('the index check uses the same default as the factory', () => {
  delete process.env.ORACLE_VECTOR_DB;
  const reason = localVectorIndexMissingReason({ dataPath: '/nonexistent/vectors.db' } as never);
  expect(reason).toBe(DEFAULT_SAFE_VECTOR_ENGINE === 'sqlite-vec' ? 'local sqlite-vec database is missing' : 'local LanceDB directory is missing');
});
