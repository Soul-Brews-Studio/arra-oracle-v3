/**
 * Embedding Providers
 *
 * Ported from Nat-s-Agents data-aware-rag.
 * ChromaDB handles embeddings internally; other stores need these.
 */

import type { EmbeddingProvider, EmbeddingProviderType, EmbedType } from './types.ts';

/**
 * Placeholder for ChromaDB's internal embeddings.
 * ChromaDB generates embeddings server-side — this is never called directly.
 */
export class ChromaDBInternalEmbeddings implements EmbeddingProvider {
  readonly name = 'chromadb-internal';
  readonly dimensions = 384; // all-MiniLM-L6-v2 default

  async embed(_texts: string[], _type?: EmbedType): Promise<number[][]> {
    throw new Error('ChromaDB handles embeddings internally. Use addDocuments() directly.');
  }
}

/**
 * Ollama local embeddings
 */
export class OllamaEmbeddings implements EmbeddingProvider {
  readonly name = 'ollama';
  dimensions: number;
  private baseUrl: string;
  private model: string;
  private _dimensionsDetected = false;
  private attempts: number;
  private retryDelayMs: number;
  private batchSize: number;
  private timeoutMs: number;

  constructor(config: { baseUrl?: string; model?: string } = {}) {
    this.baseUrl = config.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    this.model = config.model || 'nomic-embed-text';
    this.attempts = positiveInt(process.env.ORACLE_EMBED_ATTEMPTS, 3);
    this.retryDelayMs = positiveInt(process.env.ORACLE_EMBED_RETRY_DELAY_MS, 150);
    this.batchSize = positiveInt(process.env.ORACLE_EMBED_BATCH_SIZE, 50);
    this.timeoutMs = positiveInt(process.env.ORACLE_EMBED_TIMEOUT_MS, 30_000);
    // Known model dimensions (fallback before auto-detect).
    // For unknown models, set to 0 → adapters MUST probe via embed() before
    // creating columns (see #qwen3-dim-fallback issue).
    const KNOWN_DIMS: Record<string, number> = {
      'nomic-embed-text': 768,
      'qwen3-embedding': 1024,                             // 0.6B variant (default tag)
      'qwen3-embedding:0.6b': 1024,
      'qwen3-embedding:4b': 2560,
      'qwen3-embedding:8b': 4096,
      'bge-m3': 1024,
      'mxbai-embed-large': 1024,
      'all-minilm': 384,
      'qllama/multilingual-e5-large-instruct': 1024,
      'qllama/multilingual-e5-large-instruct:latest': 1024,
      'multilingual-e5-large': 1024,
      'multilingual-e5-large-instruct': 1024,
      'snowflake-arctic-embed2': 1024,
    };
    this.dimensions = KNOWN_DIMS[this.model] || 768;
  }

  async embed(texts: string[], type?: EmbedType): Promise<number[][]> {
    const prepared = texts.map(text => this.prepareText(text, type));
    const embeddings: number[][] = [];

    for (let i = 0; i < prepared.length; i += this.batchSize) {
      const batch = prepared.slice(i, i + this.batchSize);
      const data = await this.embedBatchWithRetry(batch);
      embeddings.push(...data.embeddings);

      // Auto-detect dimensions from first response
      if (!this._dimensionsDetected && data.embeddings[0]?.length > 0) {
        this.dimensions = data.embeddings[0].length;
        this._dimensionsDetected = true;
      }
    }

    return embeddings;
  }

  private prepareText(text: string, type?: EmbedType): string {
    // Truncate to ~2000 chars — Thai text uses 2-3x more tokens than English
    let truncated = text.length > 2000 ? text.slice(0, 2000) : text;

    // Instruction prefixes per model family. Wrong protocol = silent
    // 5–30pt cross-language recall regression (observed on qwen3:4b).
    //
    //   - bge-v1.5 / multilingual-e5 → "query: ..." / "passage: ..."
    //     (bge-m3 doesn't strictly require it but tolerates it)
    //   - qwen3-embedding → "Instruct: <task>\nQuery: <q>" on QUERIES ONLY
    //     passages stay raw. https://huggingface.co/Qwen/Qwen3-Embedding-0.6B
    const isQwen3 = this.model.includes('qwen3-embedding');
    const isE5 = this.model.includes('multilingual-e5') || this.model.includes('/e5-');
    const isBge = this.model.includes('bge');

    if (type === 'query') {
      if (isQwen3) {
        truncated = `Instruct: Given a search query, retrieve relevant passages that answer the query\nQuery: ${truncated}`;
      } else if (isBge || isE5) {
        truncated = `query: ${truncated}`;
      }
    } else if (type === 'passage') {
      if (isBge || isE5) {
        truncated = `passage: ${truncated}`;
      }
      // qwen3-embedding: passages stay raw per HF model card
    }

    return truncated;
  }

  private async embedBatchWithRetry(input: string[]): Promise<{ embeddings: number[][] }> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.attempts; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await fetch(`${this.baseUrl}/api/embed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: this.model, input }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`Ollama API error (${response.status}): ${error}`);
        }

        const data = await response.json() as { embeddings?: number[][]; embedding?: number[] };
        const embeddings = data.embeddings ?? (data.embedding ? [data.embedding] : undefined);
        if (!embeddings || embeddings.length !== input.length) {
          throw new Error(`Ollama returned ${embeddings?.length ?? 0} embeddings for ${input.length} inputs`);
        }
        return { embeddings };
      } catch (err) {
        lastError = err;
        if (attempt < this.attempts) {
          await sleep(this.retryDelayMs * attempt);
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    const message = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`Ollama embedding failed after ${this.attempts} attempts: ${message}`, {
      cause: lastError,
    });
  }
}

function positiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * OpenAI embeddings via API
 */
export class OpenAIEmbeddings implements EmbeddingProvider {
  readonly name = 'openai';
  readonly dimensions: number;
  private apiKey: string;
  private model: string;

  constructor(config: { apiKey?: string; model?: string } = {}) {
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY || '';
    this.model = config.model || 'text-embedding-3-small';
    this.dimensions = this.model === 'text-embedding-3-large' ? 3072 : 1536;

    if (!this.apiKey) {
      throw new Error('OpenAI API key required. Set OPENAI_API_KEY.');
    }
  }

  async embed(texts: string[], _type?: EmbedType): Promise<number[][]> {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input: texts, model: this.model }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${error}`);
    }

    const data = await response.json() as {
      data: { embedding: number[]; index: number }[];
    };

    return data.data
      .sort((a, b) => a.index - b.index)
      .map(d => d.embedding);
  }
}

/**
 * Create embedding provider from type string
 */
export function createEmbeddingProvider(
  type: EmbeddingProviderType = 'chromadb-internal',
  model?: string
): EmbeddingProvider {
  switch (type) {
    case 'ollama':
      return new OllamaEmbeddings({ model });
    case 'openai':
      return new OpenAIEmbeddings({ model });
    case 'cloudflare-ai': {
      // Dynamic import to avoid requiring CF credentials when not used
      const { CloudflareAIEmbeddings } = require('./adapters/cloudflare-vectorize.ts');
      return new CloudflareAIEmbeddings({ model });
    }
    case 'chromadb-internal':
    default:
      return new ChromaDBInternalEmbeddings();
  }
}
