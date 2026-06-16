import type { getVectorStoreConfigByModel } from '../vector/factory.ts';
import type {
  EmbeddingProviderType,
  VectorDBType,
  VectorDocument,
  VectorStoreAdapter,
} from '../vector/types.ts';
import type { SearchResult } from './types.ts';

export interface VectorSearchInput {
  query: string;
  type?: string;
  limit?: number;
  project?: string | null;
  model?: string;
}

export interface VectorSearchOutput {
  results: SearchResult[];
  total?: number;
}

export interface VectorStatsOutput {
  vector: { enabled: boolean; count: number; collection: string };
  vectors?: Array<{ key: string; model: string; collection: string; count: number; enabled: boolean }>;
}

export interface VectorHealthOutput {
  status: 'ok' | 'degraded' | 'down';
  engines: Array<{ key: string; model: string; collection: string; ok: boolean; error?: string }>;
  checked_at: string;
}

export interface VectorIndexModelInfo {
  collection: string;
  model: string;
  adapter: VectorDBType;
  provider: EmbeddingProviderType;
  count?: number;
}

export type RebuildStrategy = 'replace' | 'delete-add';

export interface VectorOperations {
  search(input: VectorSearchInput): Promise<VectorSearchOutput>;
  stats(timeoutMs?: number): Promise<VectorStatsOutput>;
  health(timeoutMs?: number): Promise<VectorHealthOutput>;
  modelStats(): Promise<Record<string, VectorIndexModelInfo>>;
  rebuildCollection(
    store: VectorStoreAdapter,
    docs: VectorDocument[],
    batchSize: number,
    onProgress?: (current: number) => void,
  ): Promise<{ strategy: RebuildStrategy }>;
  createStoreForModel(model: string): {
    store: VectorStoreAdapter;
    config: ReturnType<typeof getVectorStoreConfigByModel>;
  };
}
