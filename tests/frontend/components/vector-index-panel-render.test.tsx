import { describe, expect, test } from 'bun:test';
import { VectorIndexPanel, formatIndexEta } from '../../../frontend/src/components/VectorIndexPanel';
import { htmlFor } from '../_render';

const status = {
  jobId: 'vidx-1',
  model: 'bge-m3',
  status: 'indexing' as const,
  current: 25,
  total: 100,
  startedAt: 1781560000000,
  docsPerSec: 12.5,
  eta: 95,
};

describe('VectorIndexPanel', () => {
  test('renders per-collection reindex controls with progress details', () => {
    const html = htmlFor(
      <VectorIndexPanel
        initialStatus={status}
        initialModels={{
          'bge-m3': { collection: 'oracle_bge_m3', model: 'BAAI/bge-m3', adapter: 'lancedb', count: 100 },
          qwen3: { collection: 'oracle_qwen3', model: 'Qwen3', adapter: 'lancedb', count: 80 },
        }}
      />,
    );

    expect(html).toContain('Index Manager');
    expect(html).toContain('Index jobs and collections');
    expect(html).toContain('Vault list');
    expect(html).toContain('Vector Models');
    expect(html).toContain('75 docs need backfill');
    expect(html).toContain('Index Now');
    expect(html).toContain('Backfill Vectors');
    expect(html).toContain('Add Vault');
    expect(html).toContain('bge-m3');
    expect(html).toContain('oracle_bge_m3');
    expect(html).toContain('indexed');
    expect(html).toContain('synced');
    expect(html).toContain('qwen3');
    expect(html).toContain('Reindexing');
    expect(html).toContain('25/100 docs');
    expect(html).toContain('12.5 docs/sec');
    expect(html).toContain('ETA 1m 35s');
  });

  test('formats ETA values for compact status labels', () => {
    expect(formatIndexEta(0)).toBe('calculating');
    expect(formatIndexEta(18)).toBe('18s');
    expect(formatIndexEta(120)).toBe('2m');
  });
});
