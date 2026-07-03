import {
  activeVectorEngine,
  defaultDataPathForEngine,
  isLocalVectorEngine,
  type VectorServerConfig,
} from './config.ts';
import type { DetectedEmbeddingProvider } from './provider-detection.ts';
import type { EmbeddingProviderType, VectorDBType } from './types.ts';

export type ConfigSource = 'file' | 'defaults';
export type ResolutionSource = 'config' | 'env' | 'detect' | 'first-run-default';

export const DEFAULT_SAFE_LOCAL_ENGINE = 'lancedb' as const;
const SAFE_LOCAL_ENGINES = new Set(['sqlite-vec', 'lancedb']);

export interface VectorBackendResolution {
  engine: VectorDBType;
  source: Exclude<ResolutionSource, 'detect'>;
  dataPath: string;
  localDefault: boolean;
  returningUser: boolean;
  providerPrompt: false;
  wizard: 'optional';
  reason: string;
}

export interface EmbeddingProviderResolution {
  provider: EmbeddingProviderType;
  source: ResolutionSource;
  local: boolean;
  returningUser: boolean;
  providerPrompt: false;
  wizard: 'optional';
  reason: string;
}

export function resolveVectorBackend(
  config: VectorServerConfig,
  source: ConfigSource,
  env: NodeJS.ProcessEnv = process.env,
): VectorBackendResolution {
  const envEngine = normalizeEngine(env.ORACLE_VECTOR_DB);
  if (envEngine) return backend(envEngine, 'env', defaultDataPathForEngine(envEngine), source === 'file', 'ORACLE_VECTOR_DB selects the local vector backend.');

  const configured = activeVectorEngine(config);
  if (source === 'file') {
    return backend(configured, 'config', config.dataPath, true, 'Existing vector-server.json selects the backend.');
  }

  const selected = safeLocal(configured) ? configured : DEFAULT_SAFE_LOCAL_ENGINE;
  return backend(selected, 'first-run-default', defaultDataPathForEngine(selected), false, 'Fresh installs use the bundled local backend without a provider prompt.');
}

export function resolveEmbeddingProvider(
  config: VectorServerConfig,
  source: ConfigSource,
  providers: DetectedEmbeddingProvider[] = [],
): EmbeddingProviderResolution {
  const configured = primaryProvider(config);
  if (source === 'file' && configured) return provider(configured, 'config', true, 'Existing vector config selects the embedding provider.');
  const detected = providers.find((item) => item.available && item.type === 'ollama')
    ?? providers.find((item) => item.available && item.configured);
  if (detected) return provider(detected.type, 'detect', false, 'Detected provider is resolved automatically.');
  return provider(configured ?? 'ollama', 'first-run-default', false, 'Fresh installs default to local Ollama/FTS fallback without prompting.');
}

function backend(engine: VectorDBType, source: VectorBackendResolution['source'], dataPath: string, returningUser: boolean, reason: string): VectorBackendResolution {
  return {
    engine, source, dataPath, returningUser, reason,
    localDefault: safeLocal(engine),
    providerPrompt: false,
    wizard: 'optional',
  };
}

function provider(providerName: EmbeddingProviderType, source: ResolutionSource, returningUser: boolean, reason: string): EmbeddingProviderResolution {
  return {
    provider: providerName, source, returningUser, reason,
    local: providerName === 'ollama' || providerName === 'local' || providerName === 'none',
    providerPrompt: false,
    wizard: 'optional',
  };
}

function normalizeEngine(value: string | undefined): typeof DEFAULT_SAFE_LOCAL_ENGINE | 'sqlite-vec' | null {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'sqlite-vec' || normalized === 'lancedb' ? normalized : null;
}

function safeLocal(engine: VectorDBType): engine is typeof DEFAULT_SAFE_LOCAL_ENGINE | 'sqlite-vec' {
  return isLocalVectorEngine(engine) && SAFE_LOCAL_ENGINES.has(engine);
}

function primaryProvider(config: VectorServerConfig): EmbeddingProviderType | undefined {
  const primary = Object.values(config.collections).find((item) => item.primary)
    ?? Object.values(config.collections)[0];
  return (primary?.provider ?? primary?.embedder?.backend ?? config.embedder?.backend) as EmbeddingProviderType | undefined;
}
