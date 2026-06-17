const PRIMARY_WEIGHT_ENV = 'ORACLE_MEMORY_FANOUT_CONFIDENCE_WEIGHT';
const LEGACY_WEIGHT_ENV = 'ARRA_MEMORY_FANOUT_CONFIDENCE_WEIGHT';

export const DEFAULT_MEMORY_CONFIDENCE_WEIGHT = 0.25;
export const MEMORY_CONFIDENCE_RERANK_STRATEGY = 'confidence_weighted_rrf';

export type MemoryConfidenceRerankConfig = {
  enabled: boolean;
  confidenceWeight: number;
  defaultConfidenceWeight: number;
  source: 'default' | 'env';
  envKey?: typeof PRIMARY_WEIGHT_ENV | typeof LEGACY_WEIGHT_ENV;
  envKeys: [typeof PRIMARY_WEIGHT_ENV, typeof LEGACY_WEIGHT_ENV];
  acceptedRange: { min: 0; max: 1 };
  strategy: typeof MEMORY_CONFIDENCE_RERANK_STRATEGY;
  confidenceSource: 'query-time-confidence';
};

type Env = Record<string, string | undefined>;
type WeightEnvKey = typeof PRIMARY_WEIGHT_ENV | typeof LEGACY_WEIGHT_ENV;
type ConfiguredWeight = { key: WeightEnvKey; value: string } | undefined;

export function memoryFanoutConfidenceWeight(env: Env = process.env): number {
  return memoryConfidenceRerankConfig(env).confidenceWeight;
}

export function memoryConfidenceRerankConfig(env: Env = process.env): MemoryConfidenceRerankConfig {
  const configured = configuredWeight(env);
  const confidenceWeight = clampWeight(configured?.value);
  return {
    enabled: confidenceWeight > 0,
    confidenceWeight,
    defaultConfidenceWeight: DEFAULT_MEMORY_CONFIDENCE_WEIGHT,
    source: configured ? 'env' : 'default',
    envKey: configured?.key,
    envKeys: [PRIMARY_WEIGHT_ENV, LEGACY_WEIGHT_ENV],
    acceptedRange: { min: 0, max: 1 },
    strategy: MEMORY_CONFIDENCE_RERANK_STRATEGY,
    confidenceSource: 'query-time-confidence',
  };
}

export function clampMemoryConfidenceWeight(raw: string | number | undefined): number {
  return clampWeight(raw);
}

function configuredWeight(env: Env): ConfiguredWeight {
  if (filled(env[PRIMARY_WEIGHT_ENV])) return { key: PRIMARY_WEIGHT_ENV, value: env[PRIMARY_WEIGHT_ENV] };
  if (filled(env[LEGACY_WEIGHT_ENV])) return { key: LEGACY_WEIGHT_ENV, value: env[LEGACY_WEIGHT_ENV] };
}

function clampWeight(raw: string | number | undefined): number {
  const parsed = Number.parseFloat(String(raw ?? DEFAULT_MEMORY_CONFIDENCE_WEIGHT));
  if (!Number.isFinite(parsed)) return DEFAULT_MEMORY_CONFIDENCE_WEIGHT;
  return Math.max(0, Math.min(1, parsed));
}

function filled(value?: string): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
