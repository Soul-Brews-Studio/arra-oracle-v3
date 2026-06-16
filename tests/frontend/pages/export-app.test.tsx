import { describe, expect, test } from 'bun:test';
import { ExportApp } from '../../../frontend/src/pages/ExportApp';
import {
  backendApiUrl,
  exportResponseError,
  legacyDirectExportLink,
  messageFromPayload,
  normalizeExportAppCollections,
  readExportPayload,
  resolveDownloadLink,
} from '../../../frontend/src/pages/exportAppHelpers';
import { htmlFor } from '../_render';

describe('ExportApp legacy v2 UI', () => {
  test('normalizes legacy collection payloads', () => {
    expect(normalizeExportAppCollections({
      collections: [
        { name: 'oracle_documents', rowCount: 12, description: 'docs' },
        { collection: 'trace_log', count: '7' },
      ],
    })).toEqual([
      { id: 'oracle_documents', label: 'oracle_documents', count: 12, description: 'docs' },
      { id: 'trace_log', label: 'trace_log', count: 7, description: undefined },
    ]);
  });

  test('builds backend API and download URLs from user-configured backend', () => {
    expect(backendApiUrl('localhost:47778', '/api/v1/export/app/collections'))
      .toBe('http://localhost:47778/api/v1/export/app/collections');
    expect(resolveDownloadLink('https://oracle.example/root', { jobId: 'job 1' }, 'oracle_documents', 'json'))
      .toEqual({
        url: 'https://oracle.example/api/v1/export/app/download/job%201',
        filename: 'oracle_documents.json',
      });
    expect(resolveDownloadLink('https://oracle.example/root', { jobId: 'job 2' }, 'oracle_documents', 'csv')?.filename)
      .toBe('oracle_documents.csv');
    expect(resolveDownloadLink('https://oracle.example/root', { jobId: 'job 3' }, 'oracle_documents', 'jsonl')?.filename)
      .toBe('oracle_documents.jsonl');
    expect(legacyDirectExportLink('localhost:47778', 'oracle_documents', 'markdown').url)
      .toContain('/api/v1/export/app?collection=oracle_documents&format=markdown');
    expect(legacyDirectExportLink('localhost:47778', 'oracle_documents', 'csv').filename)
      .toBe('oracle_documents.csv');
  });

  test('extracts backend error payloads and invalid JSON failures', async () => {
    const unavailable = new Response(JSON.stringify({ error: 'database offline' }), { status: 503 });
    expect(await exportResponseError(unavailable, '/api/v1/export/app/run'))
      .toBe('/api/v1/export/app/run returned 503: database offline');
    expect(messageFromPayload({ data: { message: 'nested failure' } })).toBe('nested failure');
    await expect(readExportPayload(new Response('{bad'), '/api/v1/export/app/collections'))
      .rejects.toThrow('/api/v1/export/app/collections returned invalid JSON');
  });

  test('renders configurable backend and JSON/JSONL/CSV/Markdown export controls', () => {
    const html = htmlFor(<ExportApp initialBackendUrl="localhost:47778" autoLoad={false} />);

    expect(html).toContain('Legacy Oracle v2');
    expect(html).toContain('Old Oracle backend');
    expect(html).toContain('http://localhost:47778');
    expect(html).toContain('JSON');
    expect(html).toContain('JSONL');
    expect(html).toContain('CSV');
    expect(html).toContain('Markdown');
    expect(html).toContain('Trigger export');
  });
});
