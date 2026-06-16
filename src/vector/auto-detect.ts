import {
  clearProviderDetectionCache,
  getDetectedEmbeddingProviders,
  type ProviderDetectionOptions,
} from './provider-detection.ts';
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

export interface DetectEmbeddingProvidersOptions extends ProviderDetectionOptions {
  force?: boolean;
}

const AUTO_DETECT_PROVIDERS = new Set<EmbeddingProviderType>([
  'ollama',
  'openai',
  'gemini',
  'cloudflare-ai',
]);

export async function detectEmbeddingProviders(
  options: DetectEmbeddingProvidersOptions = {},
): Promise<AutoDetectedEmbeddingProvider[]> {
  const { force, ...detectOptions } = options;
  const result = await getDetectedEmbeddingProviders(Boolean(force), detectOptions);
  return result.providers
    .filter((provider) => AUTO_DETECT_PROVIDERS.has(provider.type))
    .map((provider) => ({
      provider: provider.type as AutoDetectProvider,
      status: provider.available ? 'available' : 'unavailable',
      ...(provider.available && { models: [...provider.models] }),
    }));
}

export function clearEmbeddingProviderAutoDetectCache(): void {
  clearProviderDetectionCache();
}
