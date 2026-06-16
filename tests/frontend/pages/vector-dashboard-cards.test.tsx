import { describe, expect, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import { VectorPage } from '../../../frontend/src/pages/VectorPage';
import { htmlFor } from '../_render';

const modelsResponse = {
  models: {
    bge: { collection: 'oracle_bge', model: 'BAAI/bge-m3', adapter: 'lancedb', count: 12 },
    qwen: { collection: 'oracle_qwen', model: 'Qwen/qwen3', adapter: 'qdrant', count: 0 },
  },
};

const healthResponse = {
  status: 'degraded',
  checked_at: '2026-06-16T00:00:00.000Z',
  engines: [
    { key: 'bge', collection: 'oracle_bge', model: 'BAAI/bge-m3', ok: true },
    { key: 'qwen', collection: 'oracle_qwen', model: 'Qwen/qwen3', ok: false, error: 'timeout' },
  ],
};

describe('VectorPage dashboard cards', () => {
  test('renders collection status details above the search widget', () => {
    const html = htmlFor(<MemoryRouter><VectorPage modelsResponse={modelsResponse} healthResponse={healthResponse} loading={false} /></MemoryRouter>);
    expect(html).toContain('Vector dashboard');
    expect(html).toContain('1/2 vector collections healthy.');
    expect(html).toContain('oracle_bge');
    expect(html).toContain('BAAI/bge-m3');
    expect(html).toContain('12 docs');
    expect(html).toContain('lancedb');
    expect(html).toContain('qdrant');
    expect(html).toContain('Down');
    expect(html).toContain('timeout');
    expect(html).toContain('Vector search');
  });
});
