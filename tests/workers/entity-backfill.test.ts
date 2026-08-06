import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, mock, test } from 'bun:test';
import { entityDocumentsFor } from '../../src/vector/entities.ts';
import { runEntityBackfillSweep } from '../../src/workers/entity-backfill.ts';
import type { VectorDocument } from '../../src/vector/types.ts';

const models = () => ({ nomic: { collection: 'test_docs', model: 'nomic-embed-text' } });
const dbs: Database[] = [];

afterEach(() => { while (dbs.length) dbs.pop()?.close(); });

describe('entity sidecar backfill worker', () => {
  test('is disabled by default and does not touch SQL or vector stores', async () => {
    const sqlite = memoryDb();
    seedDoc(sqlite, 'doc-disabled', 'default', 'Alpha Project learns Cloudflare Workers', ['Alpha Project']);
    const stores = storesFor();

    const result = await runEntityBackfillSweep(sqlite, { env: {}, models, createStore: stores.create });

    expect(result.enabled).toBe(false);
    expect(linkCount(sqlite)).toBe(0);
    expect(stores.created()).toBe(0);
  });

  test('repairs missing SQL links and entity vector docs within tenant scope', async () => {
    const sqlite = memoryDb();
    seedDoc(sqlite, 'doc-a', 'tenant-a', 'Alpha Project uses Cloudflare Workers', ['Alpha Project']);
    seedDoc(sqlite, 'doc-b', 'tenant-b', 'Beta Project uses Cloudflare Workers', ['Beta Project']);
    const stores = storesFor();

    const result = await runEntityBackfillSweep(sqlite, {
      env: { ORACLE_ENTITY_BACKFILL: '1' }, tenantId: 'tenant-a', models, createStore: stores.create,
    });

    expect(result.dryRun).toMatchObject({ docsIndexed: 1, docsWithEntities: 0, linkDocsMissing: 1, sidecarDocsMissing: 1 });
    expect(result.applied.docsRepaired).toBe(1);
    expect(result.after).toMatchObject({ docsIndexed: 1, docsWithEntities: 1, docsMissingEntities: 0, ratio: 1 });
    expect([...new Set(links(sqlite).map((row) => row.document_id))]).toEqual(['doc-a']);
    expect(stores.docs('test_docs_entities').map((doc) => doc.metadata.source_doc_id)).toContain('doc-a');
    expect(stores.docs('test_docs_entities').every((doc) => doc.metadata.tenant_id === 'tenant-a')).toBe(true);
  });

  test('is idempotent when links and sidecar docs already match expected entities', async () => {
    const sqlite = memoryDb();
    seedDoc(sqlite, 'doc-covered', 'default', 'Gamma Project keeps Arra Oracle searchable', ['Gamma Project']);
    const stores = storesFor();
    await runEntityBackfillSweep(sqlite, { env: { ORACLE_ENTITY_BACKFILL: '1' }, models, createStore: stores.create });
    const addCalls = stores.addCalls('test_docs_entities');

    const second = await runEntityBackfillSweep(sqlite, { env: { ORACLE_ENTITY_BACKFILL: '1' }, models, createStore: stores.create });

    expect(second.dryRun).toMatchObject({ linkDocsMissing: 0, sidecarDocsMissing: 0, entityDocsPlanned: 0 });
    expect(second.applied).toMatchObject({ docsRepaired: 0, linksWritten: 0, entityDocsWritten: 0, errors: [] });
    expect(stores.addCalls('test_docs_entities')).toBe(addCalls);
  });
});

function memoryDb(): Database {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE oracle_documents (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, type TEXT NOT NULL,
      source_file TEXT NOT NULL, concepts TEXT NOT NULL, created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL, indexed_at INTEGER NOT NULL, project TEXT
    );
    CREATE VIRTUAL TABLE oracle_fts USING fts5(id UNINDEXED, content, concepts);
    CREATE TABLE oracle_entity_links (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, document_id TEXT NOT NULL,
      entity TEXT NOT NULL, entity_key TEXT NOT NULL, weight INTEGER NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
  `);
  dbs.push(sqlite);
  return sqlite;
}

function seedDoc(sqlite: Database, id: string, tenantId: string, content: string, concepts: string[]) {
  const now = Date.now();
  sqlite.prepare(`INSERT INTO oracle_documents
    (id, tenant_id, type, source_file, concepts, created_at, updated_at, indexed_at, project)
    VALUES (?, ?, 'learning', ?, ?, ?, ?, ?, ?)`)
    .run(id, tenantId, `ψ/memory/${id}.md`, JSON.stringify(concepts), now, now, now, tenantId);
  sqlite.prepare('INSERT INTO oracle_fts(id, content, concepts) VALUES (?, ?, ?)')
    .run(id, content, concepts.join(' '));
}

function storesFor() {
  const stores = new Map<string, ReturnType<typeof fakeStore>>();
  return {
    create(preset: { collection: string }) {
      const existing = stores.get(preset.collection) ?? fakeStore();
      stores.set(preset.collection, existing);
      return existing;
    },
    docs(collection: string) { return stores.get(collection)?.docs() ?? []; },
    addCalls(collection: string) { return stores.get(collection)?.add.mock.calls.length ?? 0; },
    created() { return stores.size; },
  };
}

function fakeStore(seed: VectorDocument[] = []) {
  let docs = [...seed];
  const store = {
    connect: mock(async () => {}),
    ensureCollection: mock(async () => {}),
    close: mock(async () => {}),
    deleteDocuments: mock(async (ids: string[]) => { docs = docs.filter((doc) => !ids.includes(doc.id)); }),
    add: mock(async (added: VectorDocument[]) => { docs.push(...added); }),
    addDocuments(added: VectorDocument[]) { return store.add(added); },
    getAllEmbeddings: mock(async () => ({ ids: docs.map((doc) => doc.id), documents: docs.map((doc) => doc.document), embeddings: [], metadatas: docs.map((doc) => doc.metadata) })),
    docs: () => docs,
  };
  return store;
}

function links(sqlite: Database) {
  return sqlite.query<{ document_id: string; entity: string }, []>('SELECT document_id, entity FROM oracle_entity_links ORDER BY document_id, entity').all();
}
function linkCount(sqlite: Database): number { return links(sqlite).length; }

// Keeps the import covered by test-time typechecking for the exact sidecar shape.
void entityDocumentsFor;
