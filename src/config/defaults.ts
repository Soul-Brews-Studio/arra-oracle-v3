export const DEFAULT_SAFE_VECTOR_ENGINE = 'sqlite-vec' as const;
export const DEFAULT_VECTOR_LOCAL_ENGINES = ['sqlite-vec', 'lancedb', 'qdrant'] as const;
export const DEFAULT_VECTOR_COLLECTION = {
  key: 'bge-m3',
  collection: 'oracle_knowledge_bge_m3',
  model: 'bge-m3',
  provider: 'ollama',
  adapter: DEFAULT_SAFE_VECTOR_ENGINE,
  primary: true,
  enabled: true,
} as const;

export type DefaultVectorConfigSource = 'file' | 'defaults';
export type DefaultVectorResolutionSource = 'config' | 'env' | 'detect' | 'first-run-default';
export type DefaultVectorBackendResolution = {
  engine: string;
  source: DefaultVectorResolutionSource;
  localDefault: boolean;
  returningUser: boolean;
  providerPrompt: false;
  wizard: 'optional';
  reason: string;
};

const SAFE_DEFAULT_ENGINES = new Set<string>(['sqlite-vec', 'lancedb']);
const LOCAL_ENGINE_SET = new Set<string>(DEFAULT_VECTOR_LOCAL_ENGINES);

export function detectDefaultVectorBackend(input: {
  envEngine?: string;
  configuredEngine?: string;
  configSource?: DefaultVectorConfigSource;
  hasExistingIndex?: boolean;
} = {}): DefaultVectorBackendResolution {
  const envEngine = normalizeLocalEngine(input.envEngine);
  if (envEngine) return resolution(envEngine, 'env', false, 'ORACLE_VECTOR_DB selects the local vector backend.');

  const configuredEngine = normalizeEngine(input.configuredEngine);
  if (input.configSource === 'file' && configuredEngine) {
    return resolution(configuredEngine, 'config', true, 'Existing vector-server.json selects the backend.');
  }
  if (input.hasExistingIndex && configuredEngine) {
    return resolution(configuredEngine, 'detect', true, 'Existing vector index was detected; keeping the current backend.');
  }
  return resolution(DEFAULT_SAFE_VECTOR_ENGINE, 'first-run-default', false, 'Fresh installs use sqlite-vec without a provider prompt.');
}

function normalizeLocalEngine(value: string | undefined): string | null {
  const normalized = normalizeEngine(value);
  return normalized && LOCAL_ENGINE_SET.has(normalized) ? normalized : null;
}

function normalizeEngine(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}

function resolution(engine: string, source: DefaultVectorResolutionSource, returningUser: boolean, reason: string): DefaultVectorBackendResolution {
  return {
    engine,
    source,
    returningUser,
    reason,
    localDefault: SAFE_DEFAULT_ENGINES.has(engine),
    providerPrompt: false,
    wizard: 'optional',
  };
}
