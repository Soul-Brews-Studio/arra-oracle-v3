import { expect, test } from 'bun:test';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';
import { createExportBatchRoutes } from '../../../src/routes/export/batch.ts';
import type { ExportRecord } from '../../../src/routes/export/format.ts';

const decoder = new TextDecoder();

function entries(buffer: ArrayBuffer): Map<string, string> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const out = new Map<string, string>();
  let offset = 0;

  while (offset + 4 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = decoder.decode(bytes.slice(nameStart, nameStart + nameLength));
    out.set(name, decoder.decode(bytes.slice(dataStart, dataStart + size)));
    offset = dataStart + size;
  }

  return out;
}

function post(body: unknown) {
  return new Request('http://local/api/v1/export/batch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function json(res: Response) {
  return JSON.parse(await res.text());
}

function fetcher(collections: Record<string, ExportRecord[]>) {
  const app = createExportBatchRoutes({
    availableCollections: () => Object.keys(collections),
    loadCollections: (names) => Object.fromEntries(names.map((name) => [name, collections[name] ?? []])),
  });
  return createApiVersionedFetch((request) => app.handle(request));
}

test('export batch returns a zip with one file per collection and optional graph relationships', async () => {
  const fetch = fetcher({
    oracle_documents: [{
      id: 'doc-a',
      title: 'Alpha',
      content: 'First document',
      supersededBy: 'doc-b',
      createdAt: new Date('2026-06-16T00:00:00.000Z'),
    }],
    trace_log: [{ traceId: 'trace-a', parentTraceId: 'trace-root', event: 'exported' }],
  });

  const res = await fetch(post({
    collections: ['oracle_documents', 'trace_log'],
    format: 'json',
    includeGraph: true,
  }));

  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toBe('application/zip');
  expect(res.headers.get('content-disposition')).toBe('attachment; filename="arra-export-batch.zip"');
  expect(res.headers.get('x-export-collections')).toBe('oracle_documents,trace_log');

  const zipEntries = entries(await res.arrayBuffer());
  expect([...zipEntries.keys()].sort()).toEqual([
    'oracle_documents.json',
    'relationships.json',
    'trace_log.json',
  ]);

  const docs = JSON.parse(zipEntries.get('oracle_documents.json') ?? '{}');
  expect(docs).toMatchObject({
    collection: 'oracle_documents',
    rowCount: 1,
    rows: [{ id: 'doc-a', createdAt: '2026-06-16T00:00:00.000Z' }],
  });

  const graph = JSON.parse(zipEntries.get('relationships.json') ?? '{}');
  expect(graph.rows).toContainEqual(expect.objectContaining({
    type: 'document_superseded_by',
    from: 'doc-a',
    to: 'doc-b',
  }));
});

test('export batch rejects unknown collections before loading data', async () => {
  const res = await fetcher({ oracle_documents: [] })(post({
    collections: ['missing'],
    format: 'json',
    includeGraph: false,
  }));

  expect(res.status).toBe(404);
  expect(await json(res)).toEqual({
    error: 'Unknown export collection: missing',
    collections: ['oracle_documents'],
  });
});
