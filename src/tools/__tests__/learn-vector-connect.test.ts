/**
 * `oracle_learn` must await the vector store's connection before writing to it.
 *
 * `getVectorStoreByModel` returns the store synchronously while scheduling `connect()` as a
 * fire-and-forget microtask (`src/vector/factory.ts:206`). Calling `addDocuments` on the
 * returned store could therefore hit `requireDb()` with `this.db === null` and throw. The
 * throw was caught and downgraded to `embedding: 'failed'` — while the response still
 * reported `success: true`, so a caller had no way to tell the learning never reached the
 * vector index. Reported in #2931 as an "exit-0-not-success at the tooling level".
 *
 * `ensureVectorStoreConnected` (factory.ts:212) awaits the pending connect promise for that
 * model key first. This pins the call site, since the race is timing-dependent and would not
 * reproduce reliably in a test.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const learnSrc = readFileSync(join(import.meta.dir, '..', 'learn.ts'), 'utf-8');
const factorySrc = readFileSync(
  join(import.meta.dir, '..', '..', 'vector', 'factory.ts'),
  'utf-8',
);

describe('oracle_learn vector store connection', () => {
  test('awaits ensureVectorStoreConnected rather than the un-awaited getter', () => {
    expect(learnSrc).toContain('await ensureVectorStoreConnected(');
    // The regression: taking the store without awaiting its connect.
    expect(learnSrc).not.toMatch(/const vectorStore = getVectorStoreByModel\(/);
  });

  test('ensureVectorStoreConnected still awaits the pending connect promise', () => {
    // Guards the helper's contract: if it stopped awaiting, the call site above would be
    // correct in shape and still racy in practice.
    const body = factorySrc.match(
      /export async function ensureVectorStoreConnected\([\s\S]*?\n}/,
    )?.[0] ?? '';
    expect(body).toContain('connectPromises.get(');
    expect(body).toContain('await pending');
  });

  test('the failure path still reports embedding status to the caller', () => {
    // The document is written and FTS-searchable even when embedding fails, so success:true
    // is defensible — but only while the caller can see `embedding: 'failed'` and act on it.
    expect(learnSrc).toContain("embeddingStatus = 'failed'");
    expect(learnSrc).toContain('embedding: embeddingStatus');
  });
});
