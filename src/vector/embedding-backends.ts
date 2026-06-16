/** Optional embedding backends: disabled-by-default + remote HTTP. */
import type { EmbedType, EmbeddingProvider } from './types.ts';

export class EmbeddingUnavailableError extends Error {
  readonly fallback = 'fts5';

  constructor(message: string) {
    super(message);
    this.name = 'EmbeddingUnavailableError';
  }
}

export class NoneEmbeddings implements EmbeddingProvider {
  readonly name = 'none';
  readonly dimensions = 1;

  async embed(_texts: string[], _type?: EmbedType): Promise<number[][]> {
    throw new EmbeddingUnavailableError(
      'Embedding backend disabled (ORACLE_EMBEDDER=none); use FTS5 fallback.',
    );
  }
}

export interface RemoteHttpEmbeddingOptions {
  url?: string;
  model?: string;
  dimensions?: number;
  timeoutMs?: number;
}

const DEFAULT_REMOTE_DIMENSIONS = 768;
const DEFAULT_REMOTE_TIMEOUT_MS = 15_000;

export class RemoteHttpEmbeddings implements EmbeddingProvider {
  readonly name = 'remote';
  dimensions: number;
  private readonly url: string;
  private readonly model?: string;
  private readonly timeoutMs: number;

  constructor(options: RemoteHttpEmbeddingOptions = {}) {
    this.url = options.url
      || process.env.ORACLE_EMBEDDER_URL
      || process.env.ORACLE_REMOTE_EMBEDDING_URL
      || '';
    this.model = options.model || process.env.ORACLE_EMBEDDING_MODEL;
    this.dimensions = positiveInteger(
      options.dimensions ?? Number(process.env.ORACLE_EMBEDDING_DIMENSIONS),
      DEFAULT_REMOTE_DIMENSIONS,
    );
    this.timeoutMs = positiveInteger(
      options.timeoutMs ?? Number(process.env.ORACLE_EMBEDDER_TIMEOUT_MS),
      DEFAULT_REMOTE_TIMEOUT_MS,
    );
  }

  async embed(texts: string[], type?: EmbedType): Promise<number[][]> {
    if (texts.length === 0) return [];
    if (!this.url) {
      throw new EmbeddingUnavailableError('Remote embedder selected but ORACLE_EMBEDDER_URL is unset.');
    }

    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ texts, input: texts, type, model: this.model }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

      const vectors = parseRemoteEmbeddingResponse(await res.json(), texts.length);
      if (vectors[0]?.length) this.dimensions = vectors[0].length;
      return vectors;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new EmbeddingUnavailableError(`Remote embedder unavailable: ${msg}. Use FTS5 fallback.`);
    }
  }
}

export function parseRemoteEmbeddingResponse(payload: unknown, expected: number): number[][] {
  const value = record(payload) as {
    embeddings?: unknown;
    embedding?: unknown;
    data?: Array<{ embedding?: unknown; index?: number }>;
  };

  let vectors: unknown;
  if (Array.isArray(value.embeddings)) vectors = value.embeddings;
  else if (Array.isArray(value.data)) {
    vectors = [...value.data]
      .sort((a, b) => dataIndex(a) - dataIndex(b))
      .map((item) => record(item).embedding);
  } else if (Array.isArray(value.embedding)) vectors = [value.embedding];

  if (!Array.isArray(vectors)) throw new Error('missing embeddings array');
  const normalized = vectors.map((vector) => {
    if (!Array.isArray(vector) || vector.length === 0) throw new Error('embedding must be non-empty number[]');
    if (!vector.every((n) => typeof n === 'number' && Number.isFinite(n))) {
      throw new Error('embedding must contain finite numbers');
    }
    return vector as number[];
  });

  if (normalized.length !== expected) {
    throw new Error(`embedding count ${normalized.length} does not match input count ${expected}`);
  }
  return normalized;
}

function positiveInteger(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function dataIndex(value: unknown): number {
  const index = record(value).index;
  return typeof index === 'number' && Number.isFinite(index) ? index : 0;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
