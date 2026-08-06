import {
  activeVectorEngine,
  defaultDataPathForEngine,
  isLocalVectorEngine,
  type VectorServerConfig,
} from './config.ts';
import { detectDefaultVectorBackend } from '../config/defaults.ts';
import type { DetectedEmbeddingProvider } from './provider-detection.ts';
import type { EmbeddingProviderType, VectorDBType } from './types.ts';

export type ConfigSource = 'file' | 'defaults';
export type ResolutionSource = 'config' | 'env' | 'detect' | 'first-run-default';

const SAFE_LOCAL_ENGINES = new Set(['sqlite-vec', 'lancedb']);

export interface VectorBackendResolution {
  engine: VectorDBType;
  source: ResolutionSource;
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
  const choice = detectDefaultVectorBackend({
    envEngine: env.ORACLE_VECTOR_DB,
    configuredEngine: activeVectorEngine(config),
    configSource: source,
  });
  const engine = choice.engine as VectorDBType;
  const dataPath = choice.source === 'config'
    ? config.dataPath
    : isLocalVectorEngine(engine) ? defaultDataPathForEngine(engine) : config.dataPath;
  return backend(engine, choice.source, dataPath, choice.returningUser, choice.reason);
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

function backend(engine: VectorDBType, source: ResolutionSource, dataPath: string, returningUser: boolean, reason: string): VectorBackendResolution {
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

function safeLocal(engine: VectorDBType): boolean {
  return isLocalVectorEngine(engine) && SAFE_LOCAL_ENGINES.has(engine);
}

function primaryProvider(config: VectorServerConfig): EmbeddingProviderType | undefined {
  const primary = Object.values(config.collections).find((item) => item.primary)
    ?? Object.values(config.collections)[0];
  return (primary?.provider ?? primary?.embedder?.backend ?? config.embedder?.backend) as EmbeddingProviderType | undefined;
}
