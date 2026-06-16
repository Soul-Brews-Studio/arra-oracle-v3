import { describe, expect, test } from 'bun:test';
import { VectorConfigHealthSummary, vectorConfigHealthStats } from '../../../frontend/src/components/VectorConfigHealthSummary';
import { htmlFor } from '../_render';

const collections = {
  bge: { key: 'bge', collection: 'oracle_bge', model: 'bge-m3', provider: 'ollama', adapter: 'lancedb' },
  qdrant: {
    key: 'qdrant',
    collection: 'oracle_qdrant',
    model: 'qwen3',
    provider: 'remote',
    adapter: 'qdrant',
    endpoint: 'http://localhost:6333',
  },
  off: { key: 'off', collection: 'oracle_off', model: 'nomic', provider: 'none', adapter: 'lancedb', enabled: false },
};

const health = {
  bge: { ok: true, status: 'ok', collection: 'oracle_bge', adapter: 'lancedb', model: 'bge-m3' },
  qdrant: {
    ok: false,
    status: 'down',
    collection: 'oracle_qdrant',
    adapter: 'qdrant',
    model: 'qwen3',
    error: 'connection refused',
  },
};

describe('VectorConfigHealthSummary', () => {
  test('summarizes healthy, down, and disabled vector connections', () => {
    expect(vectorConfigHealthStats(collections, health).summary).toBe('1/2 enabled connections healthy · 1 down · 1 disabled');

    const html = htmlFor(<VectorConfigHealthSummary collections={collections} health={health} />);

    expect(html).toContain('Connection health');
    expect(html).toContain('1/2 enabled connections healthy · 1 down · 1 disabled');
    expect(html).toContain('qdrant: qdrant connection down');
    expect(html).toContain('http://localhost:6333');
    expect(html).toContain('connection refused');
  });
});
