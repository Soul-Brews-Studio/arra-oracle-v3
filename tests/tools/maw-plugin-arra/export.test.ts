import { describe, expect, test } from 'bun:test';
import { runExportCommand } from '../../../tools/maw-plugin-arra/commands/export.ts';

type Call = { url: string; init?: RequestInit };

function json(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    headers: { 'content-type': 'application/json' },
  });
}

describe('maw-plugin-arra export command', () => {
  test('lists available app export collections', async () => {
    const calls: Call[] = [];

    const output = await runExportCommand(['export'], {
      fetch: async (url, init) => {
        calls.push({ url, init });
        return json({ collections: [{ name: 'oracle_documents', docs: 2, formats: ['json', 'csv'] }] });
      },
    });

    expect(calls).toEqual([{ url: 'http://localhost:47778/api/v1/export/app/collections', init: undefined }]);
    expect(output).toContain('Collection | Docs | Formats');
    expect(output).toContain('oracle_documents | 2 | json,csv');
  });

  test('runs export, downloads result, and writes output file', async () => {
    const calls: Call[] = [];
    const writes: Array<{ path: string; data: string }> = [];

    const output = await runExportCommand([
      'export',
      '--collection', 'oracle_documents',
      '--format', 'csv',
      '--output', '/tmp/oracle-documents.csv',
    ], {
      fetch: async (url, init) => {
        calls.push({ url, init });
        if (url.endsWith('/api/v1/export/app/run')) {
          return json({ downloadUrl: '/api/v1/export/app/downloads/job-1' });
        }
        return new Response('id,title\n1,Oracle\n', { headers: { 'content-type': 'text/csv' } });
      },
      mkdir: async () => {},
      writeFile: async (path, data) => {
        const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
        writes.push({ path, data: text });
      },
    });

    expect(calls[0]?.url).toBe('http://localhost:47778/api/v1/export/app/run');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ collection: 'oracle_documents', format: 'csv' });
    expect(calls[1]?.url).toBe('http://localhost:47778/api/v1/export/app/downloads/job-1');
    expect(writes).toEqual([{ path: '/tmp/oracle-documents.csv', data: 'id,title\n1,Oracle\n' }]);
    expect(output).toContain('exported oracle_documents (csv) -> /tmp/oracle-documents.csv');
  });
});
