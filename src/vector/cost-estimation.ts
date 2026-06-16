import type { EmbeddingProviderType } from './types.ts';

export type CostProvider = Extract<EmbeddingProviderType, 'openai' | 'gemini' | 'ollama' | 'local' | 'remote' | 'cloudflare-ai'>;

export interface CostEstimateInput {
  docs: number;
  tokensPerDoc?: number;
  provider?: CostProvider;
  model?: string;
}

export interface CostEstimate {
  docs: number;
  tokensPerDoc: number;
  totalTokens: number;
  provider: CostProvider;
  model: string;
  estimatedUsd: number;
  formula: string;
  note: string;
}

const DEFAULT_TOKENS_PER_DOC = 500;

const PRICE_PER_MILLION: Record<CostProvider, number> = {
  openai: 0.02,
  gemini: 0,
  ollama: 0,
  local: 0,
  remote: 0,
  'cloudflare-ai': 0.008,
};

const DEFAULT_MODEL: Record<CostProvider, string> = {
  openai: 'text-embedding-3-small',
  gemini: 'text-embedding-004',
  ollama: 'nomic-embed-text',
  local: 'nomic-embed-text',
  remote: 'remote-embedder',
  'cloudflare-ai': '@cf/baai/bge-base-en-v1.5',
};

export function estimateEmbeddingCost(input: CostEstimateInput): CostEstimate {
  const docs = Math.max(0, Math.floor(input.docs));
  const tokensPerDoc = Math.max(1, Math.floor(input.tokensPerDoc ?? DEFAULT_TOKENS_PER_DOC));
  const provider = input.provider ?? 'openai';
  const model = input.model || DEFAULT_MODEL[provider];
  const totalTokens = docs * tokensPerDoc;
  const estimatedUsd = Number(((totalTokens / 1_000_000) * PRICE_PER_MILLION[provider]).toFixed(4));
  return {
    docs,
    tokensPerDoc,
    totalTokens,
    provider,
    model,
    estimatedUsd,
    formula: `${docs.toLocaleString()} docs × ~${tokensPerDoc.toLocaleString()} tokens/doc ≈ ${compactTokens(totalTokens)} tokens`,
    note: noteFor(provider),
  };
}

export function recommendEmbeddingModel(docs: number, availableProviders: string[] = []): string {
  const available = new Set(availableProviders);
  if (docs < 10_000) return 'Any configured embedding model should work for this corpus size.';
  if (docs <= 100_000) {
    if (available.has('gemini')) return 'Gemini free tier is recommended before paid remote embedding.';
    if (available.has('ollama') || available.has('local')) return 'Ollama/local embeddings are recommended to avoid remote cost.';
    return 'Use OpenAI small embeddings for speed, but review cost first.';
  }
  return 'Use Ollama/local embeddings with GPU acceleration for large indexes.';
}

function compactTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${Number((tokens / 1_000_000).toFixed(1))}M`;
  if (tokens >= 1_000) return `${Number((tokens / 1_000).toFixed(1))}K`;
  return String(tokens);
}

function noteFor(provider: CostProvider): string {
  if (provider === 'gemini') return 'Gemini estimate is $0 here because this app treats daily free-tier usage as zero marginal cost.';
  if (provider === 'ollama' || provider === 'local') return 'Local/Ollama estimate excludes hardware and electricity costs.';
  if (provider === 'remote') return 'Remote provider pricing depends on the configured service.';
  return 'Estimate only; check provider pricing before large indexing jobs.';
}
