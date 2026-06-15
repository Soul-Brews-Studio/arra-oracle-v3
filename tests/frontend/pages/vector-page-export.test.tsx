import { describe, expect, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import {
  downloadVectorCollection,
  saveBlobAsDownload,
  vectorExportFilename,
  vectorExportPath,
  VectorCollectionCards,
  VectorPage,
  type VectorCollectionCard,
} from '../../../frontend/src/pages/VectorPage';
import { htmlFor } from '../_render';

const card: VectorCollectionCard = {
  key: 'bge-m3',
  model: 'BAAI/bge-m3',
  adapter: 'lancedb',
  collection: 'oracle_knowledge_bge_m3',
  count: 42,
  healthy: true,
  healthLabel: 'Healthy',
};

describe('VectorPage export buttons', () => {
  test('renders JSON and CSV export buttons for collection cards', () => {
    const modelsResponse = { models: { bge: { collection: card.collection, model: card.model, adapter: card.adapter, count: card.count } } };
    const healthResponse = { status: 'ok' as const, engines: [{ key: 'bge', ok: true }], checked_at: 'now' };
    const html = htmlFor(<MemoryRouter><VectorPage modelsResponse={modelsResponse} healthResponse={healthResponse} loading={false} /></MemoryRouter>);
    expect(html).toContain('Vector collections');
    expect(html).toContain('oracle_knowledge_bge_m3');
    expect(html).toContain('Export JSON');
    expect(html).toContain('Export CSV');
  });

  test('renders a spinner label while a collection is downloading', () => {
    const html = htmlFor(<VectorCollectionCards cards={[card]} downloads={{ [card.collection]: 'json' }} onExport={() => {}} />);
    expect(html).toContain('Downloading JSON');
    expect(html).toContain('disabled=""');
  });

  test('builds encoded export URLs and safe filenames', () => {
    expect(vectorExportPath('oracle knowledge', 'csv')).toBe('/api/vector/export?collection=oracle+knowledge&format=csv');
    expect(vectorExportFilename('oracle knowledge/bge m3', 'json')).toBe('oracle-knowledge-bge-m3.json');
  });

  test('fetches export blobs and passes them to the download sink', async () => {
    const calls: string[] = [];
    const saved: Array<{ blob: Blob; filename: string }> = [];
    await downloadVectorCollection('oracle_knowledge_bge_m3', 'csv', {
      fetch: (input) => {
        calls.push(String(input));
        return new Response('id,content\n1,oracle\n', { status: 200, headers: { 'content-type': 'text/csv' } });
      },
      saveBlob: (blob, filename) => saved.push({ blob, filename }),
    });

    expect(calls).toEqual(['/api/vector/export?collection=oracle_knowledge_bge_m3&format=csv']);
    expect(saved[0]?.filename).toBe('oracle_knowledge_bge_m3.csv');
    await expect(saved[0]?.blob.text()).resolves.toContain('oracle');
  });

  test('uses URL.createObjectURL to trigger browser downloads', () => {
    const previousDocument = globalThis.document;
    const previousUrl = globalThis.URL;
    const clicked: string[] = [];
    const revoked: string[] = [];
    const link = {
      href: '',
      download: '',
      style: { display: '' },
      click: () => clicked.push(link.download),
      remove: () => {},
    } as HTMLAnchorElement;

    globalThis.document = { createElement: () => link, body: { appendChild: () => link } } as unknown as Document;
    globalThis.URL = {
      createObjectURL: () => 'blob:oracle',
      revokeObjectURL: (url: string) => revoked.push(url),
    } as unknown as typeof URL;
    try {
      saveBlobAsDownload(new Blob(['{}']), 'oracle.json');
    } finally {
      globalThis.document = previousDocument;
      globalThis.URL = previousUrl;
    }

    expect(link.href).toBe('blob:oracle');
    expect(link.download).toBe('oracle.json');
    expect(clicked).toEqual(['oracle.json']);
    expect(revoked).toEqual(['blob:oracle']);
  });
});
