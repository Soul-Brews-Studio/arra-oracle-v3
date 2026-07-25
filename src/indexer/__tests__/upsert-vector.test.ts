/**
 * #2806 — the daemon stored an empty-string embedding for every document.
 *
 * Reported by Berlin, a DevOps Oracle in @gon2018's multi-oracle deployment, where it went
 * unnoticed for a full working session because the queue reported `done: N, error: 0` and
 * exit 0. `upsertVector` received a precomputed vector, discarded it with `void vector`, and
 * called `addDocuments([{ document: '', … }])` — so the store embedded `''` and every
 * daemon-indexed document ended up semantically identical.
 *
 * Berlin's report asked for exactly this test: "a stored vector ≠ embed('')" plus "re-indexing
 * the same id keeps row count constant". Neither was writable before, because the function was
 * a closure inside `startDaemon` behind a real SQLite handle, LanceDB table and Ollama. That
 * untestability is why the bug survived on both `main` and `alpha`.
 */
import { describe, expect, test } from 'bun:test';
import { makeUpsertVector, type UpsertCapableStore } from '../upsert-vector.ts';

type Row = { id: string; document: string; metadata: Record<string, string | number>; vector?: number[] };

const MODELS = { 'bge-m3': { collection: 'oracle_bge_m3' }, nomic: { collection: 'oracle_nomic' } };

/**
 * A store that behaves like the LanceDB adapter after #2796's `mergeInsert`: writing an
 * existing id REPLACES that row rather than appending a second one.
 */
function fakeStore(opts: { name?: string } = {}) {
  const rows: Row[] = [];
  const calls: string[] = [];
  const store: UpsertCapableStore = {
    name: opts.name ?? 'fake-lancedb',
    async addDocuments(docs) {
      calls.push('add');
      for (const doc of docs as Row[]) {
        const at = rows.findIndex((row) => row.id === doc.id);
        if (at >= 0) rows[at] = doc;
        else rows.push(doc);
      }
    },
  };
  return { store, rows, calls };
}

/** The embedding of the empty string — what the bug stored for every document. */
const EMBED_OF_EMPTY = [0, 0, 0, 0];
const REAL_VECTOR = [0.11, -0.42, 0.87, 0.03];

function harness(opts: { name?: string } = {}) {
  const fake = fakeStore(opts);
  const upsert = makeUpsertVector({
    models: MODELS,
    getStore: async () => fake.store,
    now: () => 1_700_000_000_000,
  });
  return { ...fake, upsert };
}

describe('the stored row carries the real content, not an empty string', () => {
  test('document is the text the vector was computed from', async () => {
    const h = harness();
    await h.upsert('oracle_bge_m3', 'doc-1', REAL_VECTOR, '# a real learning about FTS5 scans');

    expect(h.rows).toHaveLength(1);
    expect(h.rows[0].document).toBe('# a real learning about FTS5 scans');
    // The precise regression: the old code passed ''.
    expect(h.rows[0].document).not.toBe('');
  });

  test('the precomputed vector is stored, not left for the store to re-embed', async () => {
    const h = harness();
    await h.upsert('oracle_bge_m3', 'doc-1', REAL_VECTOR, 'content');

    expect(h.rows[0].vector).toEqual(REAL_VECTOR);
    // VectorDocument.vector is documented as "adapters MUST use this vector and skip the
    // embedder", so a present vector also means one fewer Ollama round-trip.
    expect(h.rows[0].vector).not.toEqual(EMBED_OF_EMPTY);
  });

  test('two different documents do not end up with the same vector', async () => {
    // The observable symptom of the bug: every document semantically identical.
    const h = harness();
    await h.upsert('oracle_bge_m3', 'doc-1', [0.1, 0.2], 'first document');
    await h.upsert('oracle_bge_m3', 'doc-2', [0.9, 0.8], 'second document');

    expect(h.rows.map((row) => row.vector)).toEqual([[0.1, 0.2], [0.9, 0.8]]);
    expect(h.rows[0].vector).not.toEqual(h.rows[1].vector);
    expect(h.rows[0].document).not.toBe(h.rows[1].document);
  });

  test('metadata still carries id and indexed_at', async () => {
    const h = harness();
    await h.upsert('oracle_bge_m3', 'doc-1', REAL_VECTOR, 'content');
    expect(h.rows[0].metadata).toEqual({ id: 'doc-1', indexed_at: 1_700_000_000_000 });
  });
});

describe('re-indexing a document replaces its row instead of appending', () => {
  test('row count stays constant across three re-indexes of one id', async () => {
    const h = harness();
    for (const [vector, text] of [[[0.1], 'v1'], [[0.2], 'v2'], [[0.3], 'v3']] as const) {
      await h.upsert('oracle_bge_m3', 'doc-1', vector as number[], text);
    }

    // addDocuments appends: unguarded, this deployment went 3,325 → 3,953 rows.
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0].document).toBe('v3');
    expect(h.rows[0].vector).toEqual([0.3]);
  });

  test('one write per document — row identity is the adapter\'s job, not this layer\'s', async () => {
    // Deliberately NOT a delete-then-add here: the LanceDB adapter does a native
    // mergeInsert upsert (#2796), so doing it again at this layer would add a round-trip
    // and a window where the row is absent.
    const h = harness();
    await h.upsert('oracle_bge_m3', 'doc-1', REAL_VECTOR, 'a');
    await h.upsert('oracle_bge_m3', 'doc-1', REAL_VECTOR, 'b');
    expect(h.calls).toEqual(['add', 'add']);
  });

  test('distinct ids each keep their own row', async () => {
    const h = harness();
    await h.upsert('oracle_bge_m3', 'doc-1', [0.1], 'one');
    await h.upsert('oracle_bge_m3', 'doc-2', [0.2], 'two');
    await h.upsert('oracle_bge_m3', 'doc-1', [0.3], 'one-again');

    expect(h.rows).toHaveLength(2);
    expect(h.rows.map((row) => row.id).sort()).toEqual(['doc-1', 'doc-2']);
  });
});

describe('an unusable vector fails the job instead of poisoning the collection', () => {
  for (const [label, vector] of [
    ['empty array', []],
    ['undefined', undefined],
    ['not an array', 'nope'],
  ] as const) {
    test(`${label} throws so the queue row is marked error`, async () => {
      const h = harness();
      await expect(h.upsert('oracle_bge_m3', 'doc-1', vector as number[], 'content')).rejects.toThrow(
        /returned no vector/,
      );
      expect(h.rows).toHaveLength(0);
    });
  }

  test('an unregistered collection throws before touching the store', async () => {
    const h = harness();
    await expect(h.upsert('not_a_collection', 'doc-1', REAL_VECTOR, 'content')).rejects.toThrow(
      /No registered model has collection/,
    );
    expect(h.calls).toEqual([]);
  });
});
