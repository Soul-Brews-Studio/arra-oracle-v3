import type { VectorServerConfig, VectorStorageConfig } from './config.ts';

type RawVectorConfig = Partial<Omit<VectorServerConfig, 'version' | 'storage'>> & {
  version?: string;
  storage?: Partial<VectorStorageConfig>;
};

const VALID_VERSIONS = new Set(['1', '1.0', '2', '2.0', 'legacy']);

export function normalizeVectorConfig(raw: unknown, defaults: VectorServerConfig): VectorServerConfig {
  const parsed = record(raw) as RawVectorConfig;
  const { storage: rawStorage, ...rest } = parsed;
  const version = normalizeVersion(parsed.version);
  const config: VectorServerConfig = {
    ...defaults,
    ...rest,
    version,
    host: parsed.host ?? defaults.host,
    port: parsed.port ?? defaults.port,
    collections: parsed.collections ?? (version.startsWith('2') ? {} : defaults.collections),
    dataPath: parsed.dataPath ?? defaults.dataPath,
    embeddingEndpoint: parsed.embeddingEndpoint ?? defaults.embeddingEndpoint,
    proxy: parsed.proxy ?? defaults.proxy,
  };
  const storage = normalizeStorage(rawStorage, version.startsWith('2') ? defaults.storage : undefined);
  if (storage) config.storage = storage;
  else delete config.storage;
  return config;
}

function normalizeVersion(version: string | undefined): VectorServerConfig['version'] {
  return VALID_VERSIONS.has(version ?? '') ? version as VectorServerConfig['version'] : 'legacy';
}

function normalizeStorage(
  storage: Partial<VectorStorageConfig> | undefined,
  fallback: VectorStorageConfig | undefined,
): VectorStorageConfig | undefined {
  if (!storage && !fallback) return undefined;
  const services = storage?.services ?? fallback?.services ?? {};
  const defaultService = storage?.default ?? fallback?.default ?? Object.keys(services)[0];
  if (!defaultService) return undefined;
  return { default: defaultService, services };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
