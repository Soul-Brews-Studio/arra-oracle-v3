import type { EmbeddingProvider, EmbedType } from '../types.ts';

const DEFAULT_MODEL = 'text-embedding-004';
const DEFAULT_DIMENSIONS = 768;
const GEMINI_EMBEDDING_URL = 'https://generativelanguage.googleapis.com/v1beta';

type GeminiFetch = typeof fetch;

interface GeminiEmbeddingResponse {
  embedding?: {
    values?: unknown;
  };
}

export class GeminiEmbeddings implements EmbeddingProvider {
  readonly name = 'gemini';
  readonly dimensions = DEFAULT_DIMENSIONS;
  private readonly apiKey: string;
  private readonly fetcher: GeminiFetch;
  private readonly model: string;

  constructor(config: { apiKey?: string; fetcher?: GeminiFetch; model?: string } = {}) {
    this.apiKey = config.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
    this.fetcher = config.fetcher || fetch;
    this.model = normalizeModel(config.model || DEFAULT_MODEL);

    if (!this.apiKey) {
      throw new Error('Gemini API key required. Set GEMINI_API_KEY or GOOGLE_API_KEY.');
    }
  }

  async embed(texts: string[], _type?: EmbedType): Promise<number[][]> {
    if (!texts.length) return [];

    return Promise.all(texts.map((text) => this.embedOne(text)));
  }

  private async embedOne(text: string): Promise<number[]> {
    const response = await this.fetcher(`${GEMINI_EMBEDDING_URL}/models/${this.model}:embedContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.apiKey,
      },
      body: JSON.stringify({
        content: { parts: [{ text }] },
      }),
    });

    if (!response.ok) {
      throw new Error(`Gemini API error (${response.status}): ${await response.text()}`);
    }

    const data = await response.json() as GeminiEmbeddingResponse;
    const values = data.embedding?.values;
    if (!Array.isArray(values) || !values.every((value) => typeof value === 'number')) {
      throw new Error('Gemini API error: invalid embedding payload');
    }
    return values;
  }
}

function normalizeModel(model: string): string {
  return model.replace(/^models\//, '');
}
