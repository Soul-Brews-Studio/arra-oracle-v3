import { describe, expect, test } from 'bun:test';
import { FanOutQuery, type FanOutHit } from '../../../src/vector/fan-out.ts';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('FanOutQuery', () => {
  test('queries collections in parallel and re-ranks deduped top-K results', async () => {
    const alpha = deferred<FanOutHit[]>();
    const beta = deferred<FanOutHit[]>();
    const calls: Array<{ collection: string; query: string; limit: number }> = [];
    const engine = new FanOutQuery(async (collection, query, limit) => {
      calls.push({ collection, query, limit });
      return collection === 'alpha' ? alpha.promise : beta.promise;
    });

    const pending = engine.search('  oracle memory  ', ['alpha', 'beta'], {
      topK: 2,
      perCollectionLimit: 4,
    });
    await Promise.resolve();

    expect(calls).toEqual([
      { collection: 'alpha', query: 'oracle memory', limit: 4 },
      { collection: 'beta', query: 'oracle memory', limit: 4 },
    ]);

    alpha.resolve([
      { id: 'shared-doc', score: 0.4, content: 'alpha shared' },
      { id: 'alpha-only', score: 0.95, content: 'alpha only' },
    ]);
    beta.resolve([
      { id: 'shared-doc', score: 0.7, content: 'beta shared' },
      { id: 'beta-only', score: 0.8, content: 'beta only' },
    ]);

    const results = await pending;
    expect(results.map((result) => result.id)).toEqual(['shared-doc', 'alpha-only']);
    expect(results[0]).toMatchObject({
      id: 'shared-doc',
      sourceCollection: 'beta',
      sourceCollections: ['alpha', 'beta'],
      collectionScores: { alpha: 0.4, beta: 0.7 },
      content: 'beta shared',
    });
    expect(results[0].score).toBeCloseTo(1.1);
    expect(results[1]).toMatchObject({ id: 'alpha-only', sourceCollection: 'alpha' });
  });

  test('deduplicates collection names and derives scores from distances', async () => {
    const queried: string[] = [];
    const engine = new FanOutQuery(async (collection) => {
      queried.push(collection);
      return [{ id: `${collection}-doc`, distance: collection === 'near' ? 0.25 : 4 }];
    });

    const results = await engine.search('query', ['near', '', 'far', 'near'], { topK: 10 });

    expect(queried).toEqual(['near', 'far']);
    expect(results.map((result) => result.id)).toEqual(['near-doc', 'far-doc']);
    expect(results[0].score).toBeGreaterThan(results[1].score);
    expect(results[0].sourceCollection).toBe('near');
  });

  test('returns no results for no collections and rejects blank queries', async () => {
    const engine = new FanOutQuery(async () => [{ id: 'unused', score: 1 }]);

    await expect(engine.search('oracle', [])).resolves.toEqual([]);
    await expect(engine.search('   ', ['alpha'])).rejects.toThrow('non-empty query');
  });

  test('clamps scores, skips malformed ids, and does not double count same-collection duplicates', async () => {
    const engine = new FanOutQuery(async () => [
      { id: 'dup', score: 0.4, content: 'low' },
      { id: 'dup', score: 0.9, content: 'high' },
      { id: 'too-high', score: 4 },
      { id: 'negative', score: -1 },
      { id: 7 as any, score: 1 },
      { id: 'near', distance: -5 },
    ]);

    const results = await engine.search('query', ['alpha'], { topK: 10 });

    expect(results.find((item) => item.id === 'dup')).toMatchObject({
      score: 0.9,
      content: 'high',
      collectionScores: { alpha: 0.9 },
    });
    expect(results.find((item) => item.id === 'too-high')?.score).toBe(1);
    expect(results.find((item) => item.id === 'near')?.score).toBe(1);
    expect(results.find((item) => item.id === 'negative')?.score).toBe(0);
    expect(results.some((item) => item.id === '7')).toBe(false);
  });
});
