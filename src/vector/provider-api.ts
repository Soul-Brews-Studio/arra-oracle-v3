import {
  createEmbeddingProvider as defaultCreateProvider,
  type EmbeddingProviderOptions,
} from './embeddings.ts';
import {
  clearProviderDetectionCache,
  getDetectedEmbeddingProviders,
  type DetectedEmbeddingProvider,
  type ProviderDetectionOptions,
} from './provider-detection.ts';
import { generateDefaultConfig, loadVectorConfig, type VectorServerConfig } from './config.ts';
import { resolveEmbeddingProvider, type ConfigSource, type EmbeddingProviderResolution } from './backend-resolution.ts';
import type { EmbeddingProvider, EmbeddingProviderType } from './types.ts';

export type ProviderScope = 'local' | 'remote' | 'internal' | 'disabled';
export type ProviderStatus = 'available' | 'unavailable';

export type CreateEmbeddingProvider = (
  type?: EmbeddingProviderType,
  model?: string,
  options?: ProviderCreateOptions,
) => EmbeddingProvider;

export type ProviderCreateOptions = Pick<
  EmbeddingProviderOptions,
  'url' | 'dimensions' | 'fallback' | 'fallbackChain'
>;

export interface ProviderApiOptions extends ProviderDetectionOptions {
  createProvider?: CreateEmbeddingProvider;
  force?: boolean;
  probeText?: string;
  vectorConfig?: VectorServerConfig | null;
  configSource?: ConfigSource;
}

export type ProviderInfo = DetectedEmbeddingProvider & {
  provider: EmbeddingProviderType;
  status: ProviderStatus;
  scope: ProviderScope;
  local: boolean;
  remote: boolean;
};

export interface ProviderListResult {
  checkedAt: string;
  providers: ProviderInfo[];
  resolution: EmbeddingProviderResolution;
}

export interface ProviderTestRequest extends ProviderCreateOptions {
  provider: EmbeddingProviderType;
  model?: string;
  text?: string;
}

export type ProviderTestResult =
  | { success: true; provider: string; dimensions: number; model?: string }
  | { success: false; provider: string; error: string };

export interface EmbeddingProviderApi {
  detect(options?: ProviderApiOptions): Promise<ProviderListResult>;
  create(request: ProviderTestRequest): EmbeddingProvider;
  test(request: ProviderTestRequest): Promise<ProviderTestResult>;
}

export function createEmbeddingProviderApi(defaults: ProviderApiOptions = {}): EmbeddingProviderApi {
  const createProvider = defaults.createProvider ?? defaultCreateProvider;

  return {
    async detect(options = {}) {
      const merged = { ...defaults, ...options };
      const { force, createProvider: _createProvider, probeText: _probeText, vectorConfig, configSource, ...detectOptions } = merged;
      const result = await getDetectedEmbeddingProviders(Boolean(force), detectOptions);
      const loaded = vectorConfig === undefined ? loadVectorConfig() : vectorConfig;
      const source = configSource ?? (loaded ? 'file' : 'defaults');
      const config = loaded ?? generateDefaultConfig();
      return {
        checkedAt: result.checkedAt,
        providers: result.providers.map(toProviderInfo),
        resolution: resolveEmbeddingProvider(config, source, result.providers),
      };
    },

    create(request) {
      return createProvider(request.provider, request.model, {
        url: request.url,
        dimensions: request.dimensions,
        fallback: request.fallback,
        fallbackChain: request.fallbackChain,
      });
    },

    async test(request) {
      try {
        const provider = this.create(request);
        const vectors = await provider.embed([request.text ?? defaults.probeText ?? 'oracle provider probe'], 'query');
        return {
          success: true,
          provider: provider.name,
          dimensions: vectors[0]?.length ?? provider.dimensions,
          model: request.model,
        };
      } catch (error) {
        return {
          success: false,
          provider: request.provider,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

export async function detectEmbeddingProviderApi(
  options: ProviderApiOptions = {},
): Promise<ProviderListResult> {
  return createEmbeddingProviderApi(options).detect(options);
}

export function clearEmbeddingProviderApiCache(): void {
  clearProviderDetectionCache();
}

function toProviderInfo(provider: DetectedEmbeddingProvider): ProviderInfo {
  const scope = providerScope(provider.type);
  return {
    ...provider,
    provider: provider.type,
    status: provider.available ? 'available' : 'unavailable',
    scope,
    local: scope === 'local',
    remote: scope === 'remote',
  };
}

function providerScope(type: EmbeddingProviderType): ProviderScope {
  if (type === 'none') return 'disabled';
  if (type === 'local' || type === 'ollama') return 'local';
  if (type === 'remote' || type === 'openai' || type === 'gemini' || type === 'cloudflare-ai') return 'remote';
  return 'internal';
}
