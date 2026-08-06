import { describe, expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';
import { createTenantFetch, currentTenantId, TENANT_HEADER } from '../../../src/middleware/tenant.ts';
import { createVectorExportEndpoint } from '../../../src/routes/vector/export.ts';
import type { VectorStoreAdapter } from '../../../src/vector/types.ts';

type Doc = { id: string; document: string; metadata: Record<string, unknown> };
type StoreOptions = { docs?: Doc[]; count?: number; seenLimits?: number[] };

function store(options: StoreOptions = {}): VectorStoreAdapter {
  const docs = options.docs ?? [
    { id: 'doc-1', document: 'alpha document', metadata: { type: 'learning', source_file: 'notes/alpha.md', concepts: ['alpha'] } },
    { id: 'doc-2', document: 'bravo document', metadata: { type: 'trace', source_file: 'notes/bravo.md', concepts: 'bravo,beta' } },
  ];
  const count = options.count ?? docs.length;
  return {
    name: 'fake-vector',
    connect: mock(async () => {}),
    close: mock(async () => {}),
    ensureCollection: mock(async () => {}),
    deleteCollection: mock(async () => {}),
    addDocuments: mock(async () => {}),
    query: mock(async () => ({ ids: [], documents: [], distances: [], metadatas: [] })),
    queryById: mock(async () => ({ ids: [], documents: [], distances: [], metadatas: [] })),
    getStats: mock(async () => ({ count })),
    getCollectionInfo: mock(async () => ({ count, name: 'fake' })),
    getAllEmbeddings: mock(async (limit = 50_000) => {
      options.seenLimits?.push(limit);
      const limited = docs.slice(0, limit);
      return {
        ids: limited.map((doc) => doc.id),
        documents: limited.map((doc) => doc.document),
        embeddings: limited.map(() => [0, 0, 0]),
        metadatas: limited.map((doc) => doc.metadata),
      };
    }),
  };
}

function fetcherFor(getStore: () => VectorStoreAdapter) {
  const app = new Elysia({ prefix: '/api' }).use(createVectorExportEndpoint({ getStore }));
  return createApiVersionedFetch(createTenantFetch((request) => app.handle(request)));
}

async function exportText(format: string, getStore = () => store(), headers?: HeadersInit) {
  const fetcher = fetcherFor(getStore);
  const res = await fetcher(new Request(`http://local/api/v1/vector/export?collection=bge-m3&format=${format}`, { headers }));
  return { res, text: await res.text() };
}

describe('/api/v1/vector/export HTTP hardening', () => {
  test('serves json, jsonl, csv, and markdown with download headers', async () => {
    const cases = [
      ['json', 'application/json', 'bge-m3.json', (body: string) => expect(JSON.parse(body)[0]).toMatchObject({ id: 'doc-1' })],
      ['jsonl', 'application/x-ndjson', 'bge-m3.jsonl', (body: string) => expect(JSON.parse(body.trim().split('\n')[1])).toMatchObject({ id: 'doc-2' })],
      ['csv', 'text/csv', 'bge-m3.csv', (body: string) => expect(body).toStartWith('id,document,type,source_file,concepts\n')],
      ['markdown', 'text/markdown', 'bge-m3.md', (body: string) => expect(body).toContain('<!-- source: notes/alpha.md -->')],
    ] as const;

    for (const [format, contentType, filename, assertBody] of cases) {
      const { res, text } = await exportText(format);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain(contentType);
      expect(res.headers.get('content-disposition')).toContain(filename);
      expect(res.headers.get('x-api-version')).toBe('v1');
      assertBody(text);
    }
  });

  test('streams large jsonl collections without truncating rows', async () => {
    const seenLimits: number[] = [];
    const docs = Array.from({ length: 1_205 }, (_, index) => ({
      id: `large-${index + 1}`,
      document: `large document ${index + 1}`,
      metadata: { source_file: `notes/${index + 1}.md`, concepts: ['large'] },
    }));
    const { res, text } = await exportText('jsonl', () => store({ docs, count: docs.length, seenLimits }));
    const lines = text.trimEnd().split('\n');

    expect(res.status).toBe(200);
    expect(seenLimits).toEqual([1_205]);
    expect(lines).toHaveLength(1_205);
    expect(JSON.parse(lines.at(-1)!)).toMatchObject({ id: 'large-1205', document: 'large document 1205' });
  });

  test('uses active tenant context when selecting vector export store', async () => {
    const byTenant: Record<string, Doc[]> = {
      alpha: [{ id: 'alpha-doc', document: 'alpha only', metadata: { source_file: 'alpha.md' } }],
      beta: [{ id: 'beta-doc', document: 'beta only', metadata: { source_file: 'beta.md' } }],
    };
    const getStore = () => store({ docs: byTenant[currentTenantId() ?? ''] ?? [] });
    const headersA = { [TENANT_HEADER]: 'alpha' };
    const headersB = { [TENANT_HEADER]: 'beta' };

    const alpha = JSON.parse((await exportText('json', getStore, headersA)).text) as Array<{ id: string }>;
    const beta = JSON.parse((await exportText('json', getStore, headersB)).text) as Array<{ id: string }>;

    expect(alpha.map((row) => row.id)).toEqual(['alpha-doc']);
    expect(beta.map((row) => row.id)).toEqual(['beta-doc']);
  });

  test('returns structured errors for bad formats and unknown collections', async () => {
    const badFormat = await exportText('yaml');
    expect(badFormat.res.status).toBe(400);
    expect(JSON.parse(badFormat.text)).toMatchObject({ error: 'Invalid format' });

    const fetcher = fetcherFor(() => store());
    const missing = await fetcher(new Request('http://local/api/v1/vector/export?collection=missing&format=json'));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: 'Unknown vector collection: missing' });
  });
});
