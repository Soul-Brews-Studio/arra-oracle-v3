import type { RuntimeStatus } from '../../../src/server/types';

export interface VectorIndexModelEntry {
  collection: string;
  model: string;
  adapter: string;
  count?: number;
}

export type VectorIndexCollection = VectorIndexModelEntry;

export interface VectorIndexModelsResponse {
  models: Record<string, VectorIndexModelEntry>;
}

export interface VectorHealthEngine {
  key?: string;
  model?: string;
  collection?: string;
  ok?: boolean;
  error?: string;
}

export interface VectorHealthResponse {
  status: RuntimeStatus;
  engines: VectorHealthEngine[];
  checked_at: string;
  proxy?: string;
  error?: string;
}

export type VectorIndexJobStatus = 'idle' | 'indexing' | 'stopping' | 'stopped' | 'completed' | 'error';

export interface VectorIndexStatusResponse {
  jobId: string;
  model: string;
  status: VectorIndexJobStatus;
  current: number;
  total: number;
  startedAt: number;
  completedAt?: number;
  error?: string;
  docsPerSec: number;
  eta: number;
}

export interface VectorIndexStartResponse {
  jobId: string;
  status: 'started';
  model: string;
  batchSize: number;
}
