import { describe, expect, test } from 'bun:test';
import { VectorExportPage, exportCollectionsFromModels } from '../../../frontend/src/pages/VectorExportPage';
import { htmlFor } from '../_render';

const modelsResponse = {
  models: {
    bge: { collection: 'oracle_bge', model: 'BAAI/bge-m3', adapter: 'lancedb', count: 12 },
    qwen: { collection: 'oracle_qwen', model: 'Qwen/qwen3', adapter: 'qdrant', count: 4 },
  },
};

describe('VectorExportPage', () => {
  test('renders collection export controls', () => {
    const html = htmlFor(<VectorExportPage modelsResponse={modelsResponse} loading={false} />);
    expect(html).toContain('Vector export');
    expect(html).toContain('aria-label="Export collection"');
    expect(html).toContain('aria-label="Export format"');
    expect(html).toContain('oracle_bge');
    expect(html).toContain('JSON');
    expect(html).toContain('CSV');
    expect(html).toContain('Export');
  });

  test('renders provided available formats', () => {
    const html = htmlFor(<VectorExportPage
      modelsResponse={modelsResponse}
      loading={false}
      formats={[{ format: 'jsonl', label: 'JSONL', mimeType: 'application/x-ndjson', extension: 'jsonl' }]}
    />);
    expect(html).toContain('JSONL');
    expect(html).not.toContain('CSV');
  });

  test('normalizes model response entries into export collections', () => {
    expect(exportCollectionsFromModels(modelsResponse)).toEqual([
      { key: 'bge', collection: 'oracle_bge', model: 'BAAI/bge-m3', adapter: 'lancedb', count: 12 },
      { key: 'qwen', collection: 'oracle_qwen', model: 'Qwen/qwen3', adapter: 'qdrant', count: 4 },
    ]);
  });
});
