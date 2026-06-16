import type { EmbeddingProviderType } from './types.ts';

export interface DetectedEmbeddingProvider {
  type: EmbeddingProviderType;
  available: boolean;
  configured: boolean;
  source: 'env' | 'probe';
  models: string[];
  capabilities: string[];
  error?: string;
}

export interface ProviderDetectionOptions {
  env?: NodeJS.ProcessEnv;
  fetcher?: typeof fetch;
  ollamaUrl?: string;
  timeoutMs?: number;
}

let cached: { checkedAt: string; providers: DetectedEmbeddingProvider[] } | null = null;

function has(env: NodeJS.ProcessEnv, ...keys: string[]): boolean {
  return keys.some((key) => Boolean(env[key]?.trim()));
}

function provider(
  type: EmbeddingProviderType,
  configured: boolean,
  extras: Partial<DetectedEmbeddingProvider> = {},
): DetectedEmbeddingProvider {
  return {
    type,
    configured,
    available: configured,
    source: 'env',
    models: [],
    capabilities: ['embed'],
    ...extras,
  };
}

async function detectOllama(options: ProviderDetectionOptions): Promise<DetectedEmbeddingProvider> {
  const fetcher = options.fetcher ?? fetch;
  const base = options.ollamaUrl || options.env?.OLLAMA_BASE_URL || 'http://localhost:11434';
  try {
    const res = await fetcher(`${base}/api/tags`, { signal: AbortSignal.timeout(options.timeoutMs ?? 1500) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { models?: Array<{ name?: string }> };
    const models = (data.models ?? []).map((item) => item.name).filter(Boolean) as string[];
    return provider('ollama', true, {
      source: 'probe',
      available: true,
      models,
      capabilities: ['embed', 'local', 'models:list'],
    });
  } catch (error) {
    return provider('ollama', false, {
      source: 'probe',
      available: false,
      capabilities: ['embed', 'local', 'models:list'],
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function detectEmbeddingProviders(
  options: ProviderDetectionOptions = {},
): Promise<{ checkedAt: string; providers: DetectedEmbeddingProvider[] }> {
  const env = options.env ?? process.env;
  const cfConfigured = has(env, 'CF_ACCOUNT_ID', 'CLOUDFLARE_ACCOUNT_ID')
    && has(env, 'CF_API_TOKEN', 'CLOUDFLARE_API_TOKEN');
  const geminiConfigured = has(env, 'GEMINI_API_KEY', 'GOOGLE_API_KEY');
  const providers = [
    await detectOllama({ ...options, env }),
    provider('openai', has(env, 'OPENAI_API_KEY'), {
      models: has(env, 'OPENAI_API_KEY') ? ['text-embedding-3-small', 'text-embedding-3-large'] : [],
      capabilities: ['embed', 'remote'],
    }),
    provider('gemini', geminiConfigured, {
      models: geminiConfigured ? ['text-embedding-004'] : [],
      capabilities: ['embed', 'remote', 'free-tier'],
    }),
    provider('cloudflare-ai', cfConfigured, {
      models: cfConfigured ? ['@cf/baai/bge-base-en-v1.5'] : [],
      capabilities: ['embed', 'remote', 'edge'],
    }),
  ];
  return { checkedAt: new Date().toISOString(), providers };
}

export async function getDetectedEmbeddingProviders(
  force = false,
  options: ProviderDetectionOptions = {},
): Promise<{ checkedAt: string; providers: DetectedEmbeddingProvider[] }> {
  if (!cached || force) cached = await detectEmbeddingProviders(options);
  return cached;
}

export function clearProviderDetectionCache(): void {
  cached = null;
}
