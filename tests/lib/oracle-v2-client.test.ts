import { expect, test } from 'bun:test';
import {
  OracleV2Client,
  OracleV2ClientError,
  createOracleV2Client,
} from '../../src/lib/oracle-v2-client.ts';

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('OracleV2Client fetches collections and documents from configured base URL', async () => {
  const calls: Array<{ url: string; headers?: unknown }> = [];
  const client = createOracleV2Client({
    baseUrl: 'https://old.example/oracle/',
    headers: { authorization: 'Bearer test' },
    fetch: async (input, init) => {
      const url = String(input);
      calls.push({ url, headers: init?.headers });
      if (url === 'https://old.example/oracle/api/collections') {
        return json({ collections: ['oracle_documents', { collection: 'trace_log', rowCount: 2 }] });
      }
      if (url === 'https://old.example/oracle/api/documents?collection=oracle%20documents') {
        return json({ documents: [{ id: 'doc-1', content: 'legacy body', metadata: { type: 'learning' } }] });
      }
      return json({ error: 'missing' }, 404);
    },
  });

  await expect(client.listCollections()).resolves.toEqual([
    { name: 'oracle_documents' },
    { collection: 'trace_log', name: 'trace_log', rowCount: 2 },
  ]);
  await expect(client.listDocuments('oracle documents')).resolves.toEqual([
    { collection: 'oracle documents', id: 'doc-1', content: 'legacy body', metadata: { type: 'learning' } },
  ]);
  expect(calls.map((call) => call.url)).toEqual([
    'https://old.example/oracle/api/collections',
    'https://old.example/oracle/api/documents?collection=oracle%20documents',
  ]);
  expect(new Headers(calls[0]!.headers as Record<string, string>).get('authorization')).toBe('Bearer test');
});

test('OracleV2Client avoids duplicating /api when base URL already includes it', async () => {
  const urls: string[] = [];
  const client = new OracleV2Client({
    baseUrl: 'https://old.example/api',
    fetch: async (input) => {
      urls.push(String(input));
      return json({ collections: [{ name: 'oracle_documents', count: 1 }] });
    },
  });

  await expect(client.fetchCollections()).resolves.toMatchObject({
    collections: [{ name: 'oracle_documents', count: 1 }],
  });
  expect(urls).toEqual(['https://old.example/api/collections']);
});

test('OracleV2Client normalizes alternate payload keys and string documents', async () => {
  const urls: string[] = [];
  const client = new OracleV2Client({
    baseUrl: 'https://old.example',
    fetch: async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith('/api/collections')) {
        return json({ items: [{ key: ' trace_log ', rowCount: 2 }, { id: 'docs', documentCount: 1 }] });
      }
      return json({ rows: ['plain body', { id: 'doc-2', title: 'Second' }] });
    },
  });

  await expect(client.listCollections()).resolves.toMatchObject([
    { name: 'trace_log', rowCount: 2 },
    { name: 'docs', documentCount: 1 },
  ]);
  await expect(client.listDocuments(' trace_log ')).resolves.toEqual([
    { collection: 'trace_log', content: 'plain body' },
    { collection: 'trace_log', id: 'doc-2', title: 'Second' },
  ]);
  expect(urls).toEqual([
    'https://old.example/api/collections',
    'https://old.example/api/documents?collection=trace_log',
  ]);
});

test('OracleV2Client reports invalid inputs and backend errors', async () => {
  const client = new OracleV2Client({
    baseUrl: 'https://old.example',
    fetch: async () => new Response('unavailable', { status: 503 }),
  });

  await expect(client.listDocuments('  ')).rejects.toThrow('collection is required');
  try {
    await client.listCollections();
    throw new Error('expected failure');
  } catch (error) {
    expect(error).toBeInstanceOf(OracleV2ClientError);
    expect((error as OracleV2ClientError).status).toBe(503);
    expect((error as OracleV2ClientError).body).toBe('unavailable');
  }

  const malformed = new OracleV2Client({
    baseUrl: 'https://old.example',
    fetch: async () => json({ ok: true }),
  });
  await expect(malformed.listCollections()).rejects.toThrow('collections or items or data');
});

test('OracleV2Client rejects malformed construction options', () => {
  expect(() => new OracleV2Client(null as any)).toThrow('Oracle v2 client options are required');
  expect(() => new OracleV2Client({ baseUrl: '' })).toThrow('Oracle v2 baseUrl is required');
  expect(() => new OracleV2Client({ baseUrl: 'not-a-url' })).toThrow('absolute URL');
  expect(() => new OracleV2Client({ baseUrl: 'file:///tmp/oracle' })).toThrow('http or https');
  expect(() => new OracleV2Client({ baseUrl: 'https://old.example', timeoutMs: -1 })).toThrow('timeoutMs');
  expect(() => new OracleV2Client({ baseUrl: 'https://old.example', timeoutMs: Number.NaN })).toThrow('timeoutMs');
});

test('OracleV2Client strips base URL query and hash before appending API paths', async () => {
  const urls: string[] = [];
  const client = new OracleV2Client({
    baseUrl: 'https://old.example/oracle/?debug=1#section',
    fetch: async (input) => {
      urls.push(String(input));
      return json({ collections: [' oracle_documents '] });
    },
  });

  await expect(client.listCollections()).resolves.toEqual([{ name: 'oracle_documents' }]);
  expect(urls).toEqual(['https://old.example/oracle/api/collections']);
});

test('OracleV2Client rejects runtime-invalid collection names', async () => {
  const client = new OracleV2Client({
    baseUrl: 'https://old.example',
    fetch: async () => json({ documents: [] }),
  });

  await expect(client.listDocuments(null as any)).rejects.toThrow('collection is required');

  const malformed = new OracleV2Client({
    baseUrl: 'https://old.example',
    fetch: async () => json({ collections: ['  '] }),
  });
  await expect(malformed.listCollections()).rejects.toThrow('collections[0] is missing a name');
});

test('OracleV2Client aborts hanging requests after timeout', async () => {
  const client = new OracleV2Client({
    baseUrl: 'https://old.example',
    timeoutMs: 1,
    fetch: async (_input, init) => await new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) reject(new Error('aborted'));
      signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }),
  });

  await expect(client.listCollections()).rejects.toThrow('Oracle v2 request failed: aborted');
});
