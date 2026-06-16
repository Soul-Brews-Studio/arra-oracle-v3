import { describe, expect, test } from 'bun:test';
import { createVectorStore } from '../../src/vector/factory.ts';
import {
  CloudflareVectorizeD1Adapter,
  CloudflareWorkerAIEmbeddings,
  type CloudflareAIWorkerBinding,
  type CloudflareD1Database,
  type CloudflareD1Statement,
  type CloudflareVectorizeBinding,
} from '../../src/vector/adapters/cloudflare.ts';

type Row = { id: string; document: string; metadata: string };
type Vector = { id: string; values: number[]; metadata?: Record<string, unknown> };

class MockStatement implements CloudflareD1Statement {
  private values: Array<string | number | null> = [];
  constructor(private sql: string, private rows: Map<string, Row>) {}
  bind(...values: Array<string | number | null>) { this.values = values; return this; }
  async run<T = unknown>() {
    const [collection, id, document, metadata] = this.values;
    if (this.sql.startsWith('INSERT')) this.rows.set(`${collection}:${id}`, { id: String(id), document: String(document), metadata: String(metadata) });
    if (this.sql.startsWith('DELETE')) for (const key of [...this.rows.keys()]) if (key.startsWith(`${collection}:`)) this.rows.delete(key);
    return { results: [] as T[] };
  }
  async all<T = unknown>() {
    const [collection, ...ids] = this.values.map(String);
    const rows = [...this.rows.entries()]
      .filter(([key, row]) => key.startsWith(`${collection}:`) && (!ids.length || ids.includes(row.id)))
      .map(([, row]) => row as T);
    return { results: rows };
  }
  async first<T = unknown>() {
    if (!this.sql.includes('COUNT')) return null;
    const collection = String(this.values[0]);
    const count = [...this.rows.keys()].filter((key) => key.startsWith(`${collection}:`)).length;
    return { count } as T;
  }
}

function mockD1(): CloudflareD1Database {
  const rows = new Map<string, Row>();
  return {
    prepare: (sql) => new MockStatement(sql, rows),
    batch: async (statements) => Promise.all(statements.map((statement) => statement.run())),
  };
}

function mockAI(): CloudflareAIWorkerBinding & { calls: Array<{ model: string; text: string[] }> } {
  const calls: Array<{ model: string; text: string[] }> = [];
  return {
    calls,
    run: async (model, input) => {
      calls.push({ model, text: input.text });
      return { data: input.text.map((_, index) => [1, index + 1, 0]) };
    },
  };
}

function mockVectorize(): CloudflareVectorizeBinding & { records: Map<string, Vector>; queries: unknown[] } {
  const records = new Map<string, Vector>();
  const queries: unknown[] = [];
  return {
    records,
    queries,
    upsert: async (vectors) => { for (const vector of vectors) records.set(vector.id, vector); },
    query: async (_vector, options) => {
      queries.push(options);
      return { matches: [...records.values()].map((vector) => ({ id: vector.id, score: 0.75, metadata: vector.metadata })) };
    },
    getByIds: async (ids) => ids.map((id) => records.get(id)).filter(Boolean),
    deleteByIds: async (ids) => { for (const id of ids) records.delete(id); },
  };
}

describe('Cloudflare Workers Vectorize + D1 vector backend', () => {
  test('stores vectors in Vectorize and hydrates documents from D1', async () => {
    const ai = mockAI();
    const vectorize = mockVectorize();
    const adapter = new CloudflareVectorizeD1Adapter('edge_docs', new CloudflareWorkerAIEmbeddings(ai), {
      vectorize,
      d1: mockD1(),
    });

    await adapter.ensureCollection();
    await adapter.addDocuments([{ id: 'doc-1', document: 'hello edge', metadata: { kind: 'note' } }]);
    const result = await adapter.query('hello', Number.NaN, { kind: 'note' });

    expect(ai.calls[0]).toMatchObject({ model: '@cf/baai/bge-m3', text: ['hello edge'] });
    expect(vectorize.records.get('doc-1')?.metadata).toMatchObject({ kind: 'note', collection: 'edge_docs' });
    expect(vectorize.queries[0]).toMatchObject({ topK: 10, filter: { kind: { $eq: 'note' } } });
    expect(result).toEqual({
      ids: ['doc-1'],
      documents: ['hello edge'],
      distances: [0.25],
      metadatas: [{ kind: 'note' }],
    });
    expect(await adapter.getStats()).toEqual({ count: 1 });
  });

  test('factory selects the Workers binding adapter without REST credentials', () => {
    const store = createVectorStore({
      type: 'cloudflare-vectorize',
      collectionName: 'edge_docs',
      cfAi: mockAI(),
      cfD1: mockD1(),
      cfVectorize: mockVectorize(),
    });

    expect(store).toBeInstanceOf(CloudflareVectorizeD1Adapter);
  });
});
