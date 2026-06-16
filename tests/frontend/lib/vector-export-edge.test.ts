import { describe, expect, test } from 'bun:test';
import {
  downloadVectorCollection,
  fetchVectorExportFormats,
  normalizeVectorExportFormats,
  vectorExportFilename,
} from '../../../frontend/src/vectorExport';

describe('vector export library edge cases', () => {
  test('filters malformed format registry entries', () => {
    expect(normalizeVectorExportFormats({
      formats: [
        { format: 'parquet', label: 'Parquet', mimeType: 'application/vnd.apache.parquet', extension: 'parquet' },
        { format: 'csv', label: 'CSV', mimeType: 'text/csv' },
        null,
      ],
    })).toEqual([{ format: 'parquet', label: 'Parquet', mimeType: 'application/vnd.apache.parquet', extension: 'parquet' }]);
    expect(normalizeVectorExportFormats({ formats: 'bad' })).toEqual([]);
  });

  test('uses wildcard accepts and safe fallback filenames for custom exports', async () => {
    const calls: RequestInit[] = [];
    const saved: string[] = [];

    await downloadVectorCollection('  ###  ', 'custom', {
      fetch: (_input, init) => { calls.push(init ?? {}); return new Response('custom'); },
      saveBlob: (_blob, filename) => saved.push(filename),
    });

    expect(new Headers(calls[0]?.headers).get('accept')).toBe('*/*');
    expect(saved).toEqual(['collection.custom']);
    expect(vectorExportFilename('  Mixed/Name  ', 'jsonl')).toBe('Mixed-Name.jsonl');
  });

  test('reports unavailable fetch and failed format registry loads', async () => {
    const previousFetch = globalThis.fetch;
    Reflect.deleteProperty(globalThis, 'fetch');
    try {
      await expect(fetchVectorExportFormats()).rejects.toThrow('fetch is unavailable');
    } finally {
      globalThis.fetch = previousFetch;
    }
    await expect(fetchVectorExportFormats({ fetch: () => new Response('', { status: 503 }) })).rejects.toThrow('/api/v1/vector/export/formats returned 503');
  });
});
