import type { EmbeddingProvider, EmbeddingProviderType, EmbedType } from './types.ts';
import { NoneEmbeddings, RemoteHttpEmbeddings } from './embedding-backends.ts';
import { EmbeddingFallbackChain } from './fallback-chain.ts';
import { GeminiEmbeddings } from './providers/gemini.ts';
export { GeminiEmbeddings } from './providers/gemini.ts';
export type FallbackEvent = { from: string; to?: string; error: string };
export type EmbeddingProviderOptions = { url?: string; dimensions?: number; fallbackChain?: EmbeddingProviderType[]; fallback?: EmbeddingProviderType };
export class ChromaDBInternalEmbeddings implements EmbeddingProvider {
  readonly name = 'chromadb-internal';
  readonly dimensions = 384; // all-MiniLM-L6-v2 default
  async embed(_texts: string[], _type?: EmbedType): Promise<number[][]> {
    throw new Error('ChromaDB handles embeddings internally. Use addDocuments() directly.');
  }
}
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
    this.baseUrl = resolveOllamaBaseUrl(config.baseUrl, process.env.OLLAMA_BASE_URL, process.env.OLLAMA_HOST);
    this.model = config.model || 'nomic-embed-text';
    this.attempts = positiveInt(process.env.ORACLE_EMBED_ATTEMPTS, 3);
    this.retryDelayMs = positiveInt(process.env.ORACLE_EMBED_RETRY_DELAY_MS, 150);
    this.batchSize = positiveInt(process.env.ORACLE_EMBED_BATCH_SIZE, 50);
    this.timeoutMs = positiveInt(process.env.ORACLE_EMBED_TIMEOUT_MS, 30_000);
    const KNOWN_DIMS: Record<string, number> = {
      'nomic-embed-text': 768,
      'qwen3-embedding': 1024,
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
      if (!this._dimensionsDetected && data.embeddings[0]?.length > 0) {
        this.dimensions = data.embeddings[0].length;
        this._dimensionsDetected = true;
      }
    }
    return embeddings;
  }
  private prepareText(text: string, type?: EmbedType): string {
    let truncated = text.length > 2000 ? text.slice(0, 2000) : text;
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
        if (attempt < this.attempts) await sleep(this.retryDelayMs * attempt);
      } finally {
        clearTimeout(timeout);
      }
    }
    const message = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`Ollama embedding failed after ${this.attempts} attempts: ${message}`, { cause: lastError });
  }
}
function positiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
function resolveOllamaBaseUrl(...values: Array<string | undefined>): string {
  const raw = values.map((value) => value?.trim()).find(Boolean) || 'http://localhost:11434';
  const trimmed = raw.replace(/\/+$/, '');
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}
function sleep(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }
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
export class FallbackEmbeddings implements EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  private readonly chain: EmbeddingFallbackChain;
  constructor(
    providers: EmbeddingProvider[],
    private readonly onFallback: (event: FallbackEvent) => void = defaultFallbackLogger,
  ) {
    if (providers.length === 0) throw new Error('FallbackEmbeddings requires at least one provider');
    this.name = providers.map((provider) => provider.name).join('>');
    this.dimensions = providers[0].dimensions;
    this.chain = new EmbeddingFallbackChain(providers, {
      logger: () => undefined,
      onFallback: this.onFallback,
    });
  }
  async embed(texts: string[], type?: EmbedType): Promise<number[][]> {
    return this.chain.embed(texts, type);
  }
}
function defaultFallbackLogger(event: FallbackEvent): void {
  if (event.to) console.warn(`[EmbedderFallback] ${event.from} failed: ${event.error}; trying ${event.to}`);
  else console.warn(`[EmbedderFallback] ${event.from} failed: ${event.error}; no fallback provider left`);
}
export function createEmbeddingProvider(
  type: EmbeddingProviderType = 'none',
  model?: string,
  options: EmbeddingProviderOptions = {},
): EmbeddingProvider {
  const fallbacks = options.fallbackChain ?? (options.fallback ? [options.fallback] : []);
  const chain = [type, ...fallbacks].filter((item, index, all) =>
    item !== 'none' && all.indexOf(item) === index
  );
  if (chain.length > 1) return new FallbackEmbeddings(chain.map((item) => createSingleEmbeddingProvider(item, model, options)));
  return createSingleEmbeddingProvider(type, model, options);
}
function createSingleEmbeddingProvider(
  type: EmbeddingProviderType,
  model?: string,
  options: { url?: string; dimensions?: number } = {},
): EmbeddingProvider {
  switch (type) {
    case 'none':
      return new NoneEmbeddings();
    case 'local':
    case 'ollama':
      return new OllamaEmbeddings({ model, baseUrl: options.url });
    case 'remote':
      return new RemoteHttpEmbeddings({ model, url: options.url, dimensions: options.dimensions });
    case 'openai':
      return new OpenAIEmbeddings({ model });
    case 'gemini':
      return new GeminiEmbeddings({ model });
    case 'cloudflare-ai': {
      const { CloudflareAIEmbeddings } = require('./adapters/cloudflare-vectorize.ts');
      return new CloudflareAIEmbeddings({
        model,
        accountId: process.env.CF_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID,
        apiToken: process.env.CF_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN,
      });
    }
    case 'chromadb-internal':
    default:
      return new ChromaDBInternalEmbeddings();
  }
}
