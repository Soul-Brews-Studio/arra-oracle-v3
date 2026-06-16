import { describe, expect, test } from 'bun:test';
import { VectorFirstRunWizard, firstRunReadiness } from '../../../frontend/src/components/VectorFirstRunWizard';
import { htmlFor } from '../_render';

const rows = [
  {
    key: 'bge-m3',
    collection: 'oracle_bge_m3',
    model: 'BAAI/bge-m3',
    provider: 'ollama',
    adapter: 'lancedb' as const,
    primary: true,
    count: 12,
    health: { ok: true, status: 'ok' as const, collection: 'oracle_bge_m3', adapter: 'lancedb' as const, model: 'BAAI/bge-m3' },
  },
  {
    key: 'qwen3',
    collection: 'oracle_qwen3',
    model: 'Qwen/qwen3',
    provider: 'ollama',
    adapter: 'qdrant' as const,
    count: 0,
    health: { ok: false, status: 'down' as const, collection: 'oracle_qwen3', adapter: 'qdrant' as const, model: 'Qwen/qwen3' },
  },
];

describe('VectorFirstRunWizard', () => {
  test('summarizes first-run readiness from collection health', () => {
    expect(firstRunReadiness(rows)).toBe('2 collections · 1/2 healthy · first index bge-m3');
    expect(firstRunReadiness([])).toBe('No collections loaded yet.');
  });

  test('renders the starter step and flow controls', () => {
    const html = htmlFor(<VectorFirstRunWizard rows={rows} onRefresh={() => {}} />);
    expect(html).toContain('First-run wizard');
    expect(html).toContain('Choose a storage adapter');
    expect(html).toContain('2 collections · 1/2 healthy · first index bge-m3');
    expect(html).toContain('Next');
  });
});
