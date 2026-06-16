import { resolveVectorUrl } from '../config.ts';
import { getVectorStoreConfigByModel, type VectorStoreConfig } from './factory.ts';
import { localNativeVectorDisabledReason, localVectorIndexMissingReason } from './cpu-capabilities.ts';

export type VectorMode = 'embedded' | 'proxied' | 'disabled';

export interface VectorRuntimeStatus {
  vectorMode: VectorMode;
  vectorUrl?: string;
  vectorDisabledReason?: string;
}

export interface VectorRuntimeStatusOptions {
  env?: Record<string, string | undefined>;
  argv?: string[];
  localConfig?: VectorStoreConfig;
}

/**
 * Report how the core server is wired to vector search.
 *
 * This is intentionally observability-only: search handlers keep FTS5 available
 * as the always-on floor even when this reports disabled/proxied vector mode.
 */
export function getVectorRuntimeStatus(options: VectorRuntimeStatusOptions = {}): VectorRuntimeStatus {
  const env = options.env || process.env;
  const argv = options.argv || process.argv;
  const vectorUrl = resolveVectorUrl(env, argv).trim();
  if (vectorUrl) return { vectorMode: 'proxied', vectorUrl };

  const cfg = options.localConfig || getVectorStoreConfigByModel(undefined);
  const disabledReason = localNativeVectorDisabledReason(cfg.type);
  if (disabledReason) return { vectorMode: 'disabled', vectorDisabledReason: disabledReason };

  const indexMissingReason = localVectorIndexMissingReason(cfg);
  if (indexMissingReason) return { vectorMode: 'disabled', vectorDisabledReason: indexMissingReason };

  return { vectorMode: 'embedded' };
}
