import type { EmbeddingProviderType } from './types.ts';

export type AutoDetectProvider = Extract<
  EmbeddingProviderType,
  'ollama' | 'openai' | 'gemini' | 'cloudflare-ai'
>;

export type AutoDetectStatus = 'available' | 'unavailable';

export interface AutoDetectedEmbeddingProvider {
  provider: AutoDetectProvider;
  status: AutoDetectStatus;
  models?: string[];
}

export interface DetectEmbeddingProvidersOptions {
  env?: Record<string, string | undefined>;
  fetcher?: typeof fetch;
  force?: boolean;
  ollamaUrl?: string;
  timeoutMs?: number;
}

let cachedProviders: AutoDetectedEmbeddingProvider[] | null = null;

export async function detectEmbeddingProviders(
  options: DetectEmbeddingProvidersOptions = {},
): Promise<AutoDetectedEmbeddingProvider[]> {
  if (cachedProviders && !options.force) return cloneProviders(cachedProviders);

  const env = options.env ?? process.env;
  const providers: AutoDetectedEmbeddingProvider[] = [
    await detectOllama(options),
    envProvider('openai', hasEnv(env, 'OPENAI_API_KEY'), [
      'text-embedding-3-small',
      'text-embedding-3-large',
    ]),
    envProvider('gemini', hasEnv(env, 'GEMINI_API_KEY'), ['text-embedding-004']),
    envProvider('cloudflare-ai', hasCloudflareCredentials(env), ['@cf/baai/bge-m3']),
  ];

  cachedProviders = providers;
  return cloneProviders(providers);
}

export function clearEmbeddingProviderAutoDetectCache(): void {
  cachedProviders = null;
}

async function detectOllama(
  options: DetectEmbeddingProvidersOptions,
): Promise<AutoDetectedEmbeddingProvider> {
  const fetcher = options.fetcher ?? fetch;
  const baseUrl = options.ollamaUrl ?? 'http://localhost:11434';

  try {
    const response = await fetcher(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(options.timeoutMs ?? 1500),
    });
    if (!response.ok) return unavailable('ollama');

    const body = await response.json() as { models?: Array<{ name?: string }> };
    const models = (body.models ?? [])
      .map((model) => model.name)
      .filter((name): name is string => Boolean(name?.trim()));

    return { provider: 'ollama', status: 'available', models };
  } catch {
    return unavailable('ollama');
  }
}

function envProvider(
  provider: AutoDetectProvider,
  available: boolean,
  models: string[],
): AutoDetectedEmbeddingProvider {
  if (!available) return unavailable(provider);
  return { provider, status: 'available', models };
}

function unavailable(provider: AutoDetectProvider): AutoDetectedEmbeddingProvider {
  return { provider, status: 'unavailable' };
}

function hasCloudflareCredentials(env: Record<string, string | undefined>): boolean {
  return (hasEnv(env, 'CF_ACCOUNT_ID') && hasEnv(env, 'CF_API_TOKEN'))
    || (hasEnv(env, 'CLOUDFLARE_ACCOUNT_ID') && hasEnv(env, 'CLOUDFLARE_API_TOKEN'));
}

function hasEnv(env: Record<string, string | undefined>, key: string): boolean {
  return Boolean(env[key]?.trim());
}

function cloneProviders(
  providers: AutoDetectedEmbeddingProvider[],
): AutoDetectedEmbeddingProvider[] {
  return providers.map((provider) => ({
    ...provider,
    models: provider.models ? [...provider.models] : undefined,
  }));
}
