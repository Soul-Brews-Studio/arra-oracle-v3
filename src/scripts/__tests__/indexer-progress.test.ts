import { describe, expect, it } from 'bun:test';
import { formatIndexProgress, normalizeBatchSize } from '../indexer-progress.ts';

describe('indexer script helpers', () => {
  it('normalizes invalid batch sizes to the fallback', () => {
    expect(normalizeBatchSize(undefined, 50)).toBe(50);
    expect(normalizeBatchSize('0', 50)).toBe(50);
    expect(normalizeBatchSize('-3', 50)).toBe(50);
    expect(normalizeBatchSize('not-a-number', 50)).toBe(50);
    expect(normalizeBatchSize('25', 50)).toBe(25);
  });

  it('formats progress without Infinity or NaN when elapsed time is tiny', () => {
    const progress = formatIndexProgress({ indexed: 5, total: 10, startTimeMs: 1_000, nowMs: 1_000 });
    expect(progress.rate).not.toContain('Infinity');
    expect(progress.rate).not.toContain('NaN');
    expect(progress.eta).not.toContain('Infinity');
    expect(progress.eta).not.toContain('NaN');
  });
});
