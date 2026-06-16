export interface FanOutHit {
  id: string;
  score?: number;
  distance?: number;
  content?: string;
  document?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface FanOutResult extends FanOutHit {
  score: number;
  sourceCollection: string;
  sourceCollections: string[];
  collectionScores: Record<string, number>;
}

export type FanOutCollectionSearch = (
  collection: string,
  query: string,
  limit: number,
) => Promise<FanOutHit[]>;

export interface FanOutQueryDefaults {
  topK?: number;
  perCollectionLimit?: number;
}

export interface FanOutSearchOptions {
  topK?: number;
  perCollectionLimit?: number;
}

type Accumulator = {
  id: string;
  bestHit: FanOutHit;
  bestCollection: string;
  bestScore: number;
  combinedScore: number;
  sourceCollections: string[];
  collectionScores: Record<string, number>;
};

function positiveInt(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function uniqueCollections(collections: string[]): string[] {
  const seen = new Set<string>();
  return collections
    .map((collection) => collection.trim())
    .filter((collection) => {
      if (!collection || seen.has(collection)) return false;
      seen.add(collection);
      return true;
    });
}

function scoreFor(hit: FanOutHit): number {
  if (typeof hit.score === 'number' && Number.isFinite(hit.score)) return hit.score;
  if (typeof hit.distance === 'number' && Number.isFinite(hit.distance)) {
    return 1 / (1 + Math.max(0, hit.distance));
  }
  return 0;
}

function mergeHit(acc: Accumulator, collection: string, hit: FanOutHit, score: number): void {
  acc.combinedScore += score;
  acc.collectionScores[collection] = (acc.collectionScores[collection] ?? 0) + score;
  if (!acc.sourceCollections.includes(collection)) acc.sourceCollections.push(collection);
  if (score > acc.bestScore) {
    acc.bestHit = hit;
    acc.bestCollection = collection;
    acc.bestScore = score;
  }
}

function toResult(acc: Accumulator): FanOutResult {
  return {
    ...acc.bestHit,
    id: acc.id,
    score: acc.combinedScore,
    sourceCollection: acc.bestCollection,
    sourceCollections: acc.sourceCollections,
    collectionScores: acc.collectionScores,
  };
}

export class FanOutQuery {
  constructor(
    private readonly searchCollection: FanOutCollectionSearch,
    private readonly defaults: FanOutQueryDefaults = {},
  ) {}

  async search(query: string, collections: string[], options: FanOutSearchOptions = {}): Promise<FanOutResult[]> {
    const q = query.trim();
    if (!q) throw new Error('FanOutQuery requires a non-empty query');

    const topK = positiveInt(options.topK ?? this.defaults.topK, 10);
    const perCollectionLimit = positiveInt(
      options.perCollectionLimit ?? this.defaults.perCollectionLimit,
      topK,
    );
    const targets = uniqueCollections(collections);
    if (!targets.length) return [];

    const batches = await Promise.all(targets.map(async (collection) => ({
      collection,
      hits: await this.searchCollection(collection, q, perCollectionLimit),
    })));

    return this.merge(batches).slice(0, topK);
  }

  private merge(batches: Array<{ collection: string; hits: FanOutHit[] }>): FanOutResult[] {
    const byId = new Map<string, Accumulator>();
    for (const { collection, hits } of batches) {
      for (const hit of hits) {
        const id = hit.id.trim();
        if (!id) continue;
        const score = scoreFor(hit);
        const existing = byId.get(id);
        if (existing) {
          mergeHit(existing, collection, hit, score);
          continue;
        }
        byId.set(id, {
          id,
          bestHit: hit,
          bestCollection: collection,
          bestScore: score,
          combinedScore: score,
          sourceCollections: [collection],
          collectionScores: { [collection]: score },
        });
      }
    }

    return [...byId.values()]
      .map(toResult)
      .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
  }
}
