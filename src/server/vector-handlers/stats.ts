import { localVectorOperations } from '../vector-operations.ts';

export async function handleVectorStats(): Promise<{
  vector: { enabled: boolean; count: number; collection: string };
  vectors?: Array<{ key: string; model: string; collection: string; count: number; enabled: boolean }>;
}> {
  return localVectorOperations.stats();
}

export async function handleVectorHealth(): Promise<{
  status: 'ok' | 'degraded' | 'down';
  engines: Array<{ key: string; model: string; collection: string; ok: boolean; error?: string }>;
  checked_at: string;
}> {
  return localVectorOperations.health();
}
