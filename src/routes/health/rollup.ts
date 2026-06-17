type DbStatus = { status: 'connected' | 'error' };
type PluginStatus = 'ok' | 'degraded';
type VectorStatus = { status: 'ok' | 'degraded' | 'down' };
type VectorServerStatus = { configured: boolean; status: 'ok' | 'down' | 'unconfigured' };
type VectorRuntimeStatus = { vectorMode: 'embedded' | 'proxied' | 'disabled' };

export type HealthRollupStatus = 'ok' | 'degraded';

export function healthRollupStatus(
  db: DbStatus,
  pluginStatus: PluginStatus,
  vector: VectorStatus,
  vectorServer: VectorServerStatus,
  runtime: VectorRuntimeStatus,
): HealthRollupStatus {
  if (db.status !== 'connected' || pluginStatus !== 'ok') return 'degraded';
  return vectorRollupOk(vector, vectorServer, runtime) ? 'ok' : 'degraded';
}

function vectorRollupOk(
  vector: VectorStatus,
  vectorServer: VectorServerStatus,
  runtime: VectorRuntimeStatus,
): boolean {
  if (runtime.vectorMode === 'disabled') return true;
  if (runtime.vectorMode === 'proxied' || vectorServer.configured) {
    return vectorServer.status === 'ok';
  }
  return vector.status === 'ok';
}
