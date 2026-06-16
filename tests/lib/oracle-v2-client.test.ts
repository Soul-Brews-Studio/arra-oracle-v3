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
