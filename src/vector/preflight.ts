import { getVectorRuntimeStatus, type VectorRuntimeStatus } from './runtime-status.ts';
import { readVectorServerHealth, type VectorServerHealth } from '../routes/health/vector-server.ts';

export interface VectorPreflightStatus extends VectorRuntimeStatus {
  vectorAvailable: boolean;
  vectorServer?: VectorServerHealth;
}

export interface VectorPreflightOptions {
  env?: Record<string, string | undefined>;
  argv?: string[];
  fetcher?: typeof fetch;
  warn?: (message: string) => void;
}

export async function preflightVectorRuntime(options: VectorPreflightOptions = {}): Promise<VectorPreflightStatus> {
  const env = options.env ?? process.env;
  const argv = options.argv ?? process.argv;
  const runtime = getVectorRuntimeStatus({ env, argv });
  if (runtime.vectorMode !== 'proxied') return { ...runtime, vectorAvailable: runtime.vectorMode === 'embedded' };

  const vectorServer = await readVectorServerHealth(options.fetcher ?? fetch, env, argv);
  const vectorAvailable = vectorServer.status === 'ok';
  if (!vectorAvailable) options.warn?.(formatVectorPreflightWarning(vectorServer));
  return { ...runtime, vectorAvailable, vectorServer };
}

function formatVectorPreflightWarning(vectorServer: VectorServerHealth): string {
  const target = vectorServer.url ?? 'configured vector server';
  const detail = vectorServer.error ? `: ${vectorServer.error}` : '';
  return `[Vector] VECTOR_URL preflight failed for ${target}${detail}`;
}
