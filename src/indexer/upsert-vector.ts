/**
 * The daemon's vector-write step, extracted so it can be tested without LanceDB or Ollama.
 *
 * It lived as a closure inside `startDaemon`, which needs a real SQLite handle, real model
 * presets, a live LanceDB table and a running Ollama — so nothing covered it, and #2806
 * survived on both `main` and `alpha` for months while every pipeline metric read green.
 * Berlin's report asked for "a test asserting a stored vector ≠ embed('')"; that test is
 * only writable if this function can be reached with a fake store.
 *
 * See `__tests__/upsert-vector.test.ts`.
 */

/** The slice of `VectorStoreAdapter` this step needs. */
export interface UpsertCapableStore {
  readonly name: string;
  addDocuments(
    docs: Array<{ id: string; document: string; metadata: Record<string, string | number>; vector?: number[] }>,
  ): Promise<void>;
  /** Optional on the adapter interface — only LanceDB implements it today. */
  deleteDocuments?(ids: string[]): Promise<void>;
}

export interface UpsertVectorDeps {
  /** Model presets keyed by model key; only `collection` is read. */
  models: Record<string, { collection: string }>;
  getStore: (modelKey: string) => Promise<UpsertCapableStore>;
  /** Injectable for tests. Defaults to `Date.now`. */
  now?: () => number;
  /** Injectable for tests. Defaults to `console.error`. */
  warn?: (message: string) => void;
}

export type UpsertVector = (
  collection: string,
  docId: string,
  vector: number[],
  text: string,
) => Promise<void>;

/**
 * Build the daemon's `upsertVector`.
 *
 * Three properties this guarantees, each of which was violated before #2806:
 *
 * 1. **The row stores the text the vector came from.** The old code passed `document: ''`
 *    and dropped the vector with `void vector`, so the store embedded the empty string and
 *    every daemon-indexed document got the same meaningless embedding.
 * 2. **Re-indexing one document does not grow the collection.** `addDocuments` appends on a
 *    duplicate id — a re-index took one deployment from 3,325 to 3,953 rows — so the delete
 *    has to happen first. `deleteDocuments` is optional on the adapter interface; where it is
 *    missing we warn once per model instead of silently appending.
 * 3. **An unusable vector fails the job.** A thrown error is marked on the queue row; a
 *    stored bad vector is invisible. Loud beats silent.
 */
export function makeUpsertVector(deps: UpsertVectorDeps): UpsertVector {
  const now = deps.now ?? Date.now;
  const warn = deps.warn ?? ((message: string) => console.error(message));
  const warnedNoDelete = new Set<string>();

  return async function upsertVector(collection, docId, vector, text) {
    const entry = Object.entries(deps.models).find(([, model]) => model.collection === collection);
    if (!entry) throw new Error(`No registered model has collection: ${collection}`);
    const [modelKey] = entry;

    if (!Array.isArray(vector) || vector.length === 0) {
      throw new Error(`Refusing to store ${docId} in ${collection}: embedder returned no vector`);
    }

    const store = await deps.getStore(modelKey);

    if (typeof store.deleteDocuments === 'function') {
      await store.deleteDocuments([docId]);
    } else if (!warnedNoDelete.has(modelKey)) {
      warnedNoDelete.add(modelKey);
      warn(
        `[arra-indexer] ${store.name} has no deleteDocuments — re-indexing a doc will append a duplicate row instead of replacing it`,
      );
    }

    await store.addDocuments([
      { id: docId, document: text, vector, metadata: { id: docId, indexed_at: now() } },
    ]);
  };
}
