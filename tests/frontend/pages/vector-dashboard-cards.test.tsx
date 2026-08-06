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
  services: [
    { name: 'lancedb', type: 'builtin', status: 'green', available: true, health: { status: 'up' } },
    { name: 'turbovec', type: 'proxy', status: 'red', available: false, health: { status: 'down', error: 'offline' } },
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
    expect(html).toContain('Registered services');
    expect(html).toContain('1/2 services up');
    expect(html).toContain('turbovec: down · offline');
    expect(html).toContain('Vector search');
  });

  test('uses full-width responsive grids instead of the narrow sidebar layout', () => {
    const html = htmlFor(<MemoryRouter><VectorPage modelsResponse={modelsResponse} healthResponse={healthResponse} loading={false} /></MemoryRouter>);
    expect(html).toContain('class="grid min-w-0 gap-5" aria-label="Vector dashboard cards"');
    expect(html).toContain('[grid-template-columns:repeat(auto-fit,minmax(min(100%,18rem),1fr))]');
    expect(html).not.toContain('xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]');
  });
});
