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
    this.dimensions = options.dimensions
      || Number(process.env.ORACLE_EMBEDDING_DIMENSIONS || 768);
    this.timeoutMs = options.timeoutMs
      || Number(process.env.ORACLE_EMBEDDER_TIMEOUT_MS || 15_000);
  }

  async embed(texts: string[], type?: EmbedType): Promise<number[][]> {
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
  const value = payload as {
    embeddings?: unknown;
    embedding?: unknown;
    data?: Array<{ embedding?: unknown; index?: number }>;
  };

  let vectors: unknown;
  if (Array.isArray(value.embeddings)) vectors = value.embeddings;
  else if (Array.isArray(value.data)) {
    vectors = [...value.data]
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((item) => item.embedding);
  } else if (Array.isArray(value.embedding)) vectors = [value.embedding];

  if (!Array.isArray(vectors)) throw new Error('missing embeddings array');
  const normalized = vectors.map((vector) => {
    if (!Array.isArray(vector) || !vector.every((n) => typeof n === 'number')) {
      throw new Error('embedding must be number[]');
    }
    return vector as number[];
  });

  if (normalized.length !== expected) {
    throw new Error(`embedding count ${normalized.length} does not match input count ${expected}`);
  }
  return normalized;
}
