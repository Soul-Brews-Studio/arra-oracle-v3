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

/** A store that behaves like LanceDB: add appends, delete removes by id. */
function fakeStore(opts: { withDelete?: boolean; name?: string } = {}) {
  const rows: Row[] = [];
  const calls: string[] = [];
  const store: UpsertCapableStore = {
    name: opts.name ?? 'fake-lancedb',
    async addDocuments(docs) {
      calls.push('add');
      rows.push(...(docs as Row[]));
    },
    ...(opts.withDelete === false ? {} : {
      async deleteDocuments(ids: string[]) {
        calls.push('delete');
        for (const id of ids) {
          const at = rows.findIndex((row) => row.id === id);
          if (at >= 0) rows.splice(at, 1);
        }
      },
    }),
  };
  return { store, rows, calls };
}

/** The embedding of the empty string — what the bug stored for every document. */
const EMBED_OF_EMPTY = [0, 0, 0, 0];
const REAL_VECTOR = [0.11, -0.42, 0.87, 0.03];

function harness(opts: { withDelete?: boolean; name?: string } = {}) {
  const fake = fakeStore(opts);
  const warnings: string[] = [];
  const upsert = makeUpsertVector({
    models: MODELS,
    getStore: async () => fake.store,
    now: () => 1_700_000_000_000,
    warn: (message) => warnings.push(message),
  });
  return { ...fake, warnings, upsert };
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

  test('the delete happens before the add, every time', async () => {
    const h = harness();
    await h.upsert('oracle_bge_m3', 'doc-1', REAL_VECTOR, 'a');
    await h.upsert('oracle_bge_m3', 'doc-1', REAL_VECTOR, 'b');
    expect(h.calls).toEqual(['delete', 'add', 'delete', 'add']);
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

describe('an adapter without deleteDocuments is warned about, not silently appended to', () => {
  test('warns once per model, not once per document', async () => {
    const h = harness({ withDelete: false, name: 'qdrant' });
    for (const id of ['a', 'b', 'c']) await h.upsert('oracle_bge_m3', id, REAL_VECTOR, id);

    expect(h.warnings).toHaveLength(1);
    expect(h.warnings[0]).toContain('qdrant');
    expect(h.warnings[0]).toContain('deleteDocuments');
  });

  test('documents are still written — the warning is not a refusal', async () => {
    const h = harness({ withDelete: false });
    await h.upsert('oracle_bge_m3', 'doc-1', REAL_VECTOR, 'content');
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0].document).toBe('content');
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
