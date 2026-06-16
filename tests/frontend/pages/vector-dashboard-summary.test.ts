import { describe, expect, test } from 'bun:test';
import { buildVectorCollectionCards, vectorDashboardSummary } from '../../../frontend/src/pages/VectorPage';

describe('vectorDashboardSummary', () => {
  test('counts healthy cards from model and health responses', () => {
    const cards = buildVectorCollectionCards(
      { models: { bge: { collection: 'bge_docs', model: 'bge-m3', adapter: 'lancedb', count: 1 } } },
      { status: 'ok', engines: [{ key: 'bge', model: 'bge-m3', collection: 'bge_docs', ok: true }], checked_at: 'now' },
    );

    expect(cards).toMatchObject([{ collection: 'bge_docs', healthy: true, healthLabel: 'Healthy' }]);
    expect(vectorDashboardSummary(cards, 'ready')).toBe('1/1 vector collections healthy.');
  });
});
