import type { EmbeddingProvider, EmbeddingProviderType, EmbedType } from './types.ts';
import { NoneEmbeddings, RemoteHttpEmbeddings } from './embedding-backends.ts';

export type FallbackEvent = { from: string; to?: string; error: string };

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

  constructor(config: { baseUrl?: string; model?: string } = {}) {
    this.baseUrl = config.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    this.model = config.model || 'nomic-embed-text';
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
    const embeddings: number[][] = [];

    for (const text of texts) {
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

      const response = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, prompt: truncated }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Ollama API error: ${error}`);
      }

      const data = await response.json() as { embedding: number[] };
      embeddings.push(data.embedding);

      if (!this._dimensionsDetected && data.embedding.length > 0) {
        this.dimensions = data.embedding.length;
        this._dimensionsDetected = true;
      }
    }

    return embeddings;
  }
}

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

export class GeminiEmbeddings implements EmbeddingProvider {
  readonly name = 'gemini';
  readonly dimensions = 768;
  private apiKey: string;
  private model: string;

  constructor(config: { apiKey?: string; model?: string } = {}) {
    this.apiKey = config.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
    this.model = config.model || 'text-embedding-004';
    if (!this.apiKey) throw new Error('Gemini API key required. Set GEMINI_API_KEY.');
  }

  async embed(texts: string[], _type?: EmbedType): Promise<number[][]> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:batchEmbedContents?key=${this.apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: texts.map((text) => ({ model: `models/${this.model}`, content: { parts: [{ text }] } })) }),
    });
    if (!response.ok) throw new Error(`Gemini API error: ${await response.text()}`);
    const data = await response.json() as { embeddings?: Array<{ values?: number[] }> };
    const vectors = data.embeddings?.map((item) => item.values);
    if (!vectors || vectors.length !== texts.length || vectors.some((v) => !Array.isArray(v))) {
      throw new Error('Gemini API error: invalid embedding payload');
    }
    return vectors as number[][];
  }
}

export class FallbackEmbeddings implements EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;

  constructor(
    private readonly providers: EmbeddingProvider[],
    private readonly onFallback: (event: FallbackEvent) => void = defaultFallbackLogger,
  ) {
    if (providers.length === 0) throw new Error('FallbackEmbeddings requires at least one provider');
    this.name = providers.map((provider) => provider.name).join('>');
    this.dimensions = providers[0].dimensions;
  }

  async embed(texts: string[], type?: EmbedType): Promise<number[][]> {
    let lastError: unknown;
    for (let i = 0; i < this.providers.length; i++) {
      const provider = this.providers[i];
      try {
        return await provider.embed(texts, type);
      } catch (error) {
        lastError = error;
        this.onFallback({ from: provider.name, to: this.providers[i + 1]?.name, error: errorMessage(error) });
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}

function defaultFallbackLogger(event: FallbackEvent): void {
  if (event.to) console.warn(`[EmbedderFallback] ${event.from} failed: ${event.error}; trying ${event.to}`);
  else console.warn(`[EmbedderFallback] ${event.from} failed: ${event.error}; no fallback provider left`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createEmbeddingProvider(
  type: EmbeddingProviderType = 'none',
  model?: string,
  options: { url?: string; dimensions?: number; fallbackChain?: EmbeddingProviderType[] } = {},
): EmbeddingProvider {
  const chain = [type, ...(options.fallbackChain ?? [])].filter((item, index, all) =>
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
      // Dynamic import to avoid requiring CF credentials when not used
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
