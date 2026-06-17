import { Elysia, t } from 'elysia';
import { DB_PATH } from '../../config.ts';
import { getSetting, isDbLockError, sqlite } from '../../db/index.ts';
import { currentTenantId } from '../../middleware/tenant.ts';
import { handleStats } from '../../server/handlers.ts';
import { handleVectorStats } from '../../server/vector-handlers.ts';
import { tenantStats } from './tenant-stats.ts';

type VectorStats = Awaited<ReturnType<typeof handleVectorStats>>;
type StatsEndpointOptions = { vectorStats?: () => Promise<VectorStats> };
type FtsStatus = 'healthy' | 'empty' | 'missing' | 'partial' | 'unavailable';
type VectorStatus = 'ok' | 'degraded' | 'down';

const fallbackVector = { vector: { enabled: false, count: 0, collection: 'oracle_knowledge' } };

function statsResponseSchema() {
  return t.Object({
    total: t.Optional(t.Number()),
    total_docs: t.Optional(t.Number()),
    by_type: t.Record(t.String(), t.Number()),
    is_indexing: t.Optional(t.Boolean()),
    indexing: t.Optional(t.Boolean()),
    vector: t.Optional(t.Object({ enabled: t.Boolean(), count: t.Number(), collection: t.String() })),
    vector_status: t.Optional(t.Union([t.Literal('ok'), t.Literal('degraded'), t.Literal('down')])),
    vector_error: t.Optional(t.String()),
    fts: t.Optional(t.Object({ status: t.String(), indexed: t.Number(), missing: t.Number(), error: t.Optional(t.String()) })),
    fts_status: t.Optional(t.String()),
    fts_indexed: t.Optional(t.Number()),
    database: t.Optional(t.String()),
    vault_repo: t.Optional(t.Nullable(t.String())),
    tenant: t.Optional(t.Object({ id: t.String(), scope: t.String() })),
    error: t.Optional(t.String()),
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function totalDocs(stats: Record<string, unknown>): number {
  const total = stats.total_docs ?? stats.total;
  return typeof total === 'number' && Number.isFinite(total) ? total : 0;
}

function ftsIndexedCount(): number {
  const tenantId = currentTenantId();
  if (!tenantId) {
    return (sqlite.prepare('SELECT COUNT(*) AS count FROM oracle_fts').get() as { count: number }).count;
  }
  return (sqlite.prepare(`
    SELECT COUNT(*) AS count FROM oracle_fts f
    JOIN oracle_documents d ON d.id = f.id
    WHERE d.tenant_id = ?
  `).get(tenantId) as { count: number }).count;
}

function readFtsHealth(total: number): { status: FtsStatus; indexed: number; missing: number; error?: string } {
  try {
    const indexed = ftsIndexedCount();
    const missing = Math.max(0, total - indexed);
    const status: FtsStatus = total === 0 ? 'empty' : indexed === 0 ? 'missing' : missing > 0 ? 'partial' : 'healthy';
    return { status, indexed, missing };
  } catch (error) {
    return { status: 'unavailable', indexed: 0, missing: total, error: errorMessage(error) };
  }
}

function vectorStatus(stats: VectorStats): VectorStatus {
  const engines = stats.vectors ?? [];
  if (!engines.length) return stats.vector.enabled ? 'ok' : 'down';
  const enabled = engines.filter((engine) => engine.enabled).length;
  return enabled === engines.length ? 'ok' : enabled === 0 ? 'down' : 'degraded';
}

export function createStatsEndpoint(options: StatsEndpointOptions = {}) {
  const readVectorStats = options.vectorStats ?? handleVectorStats;
  return new Elysia().get('/stats', async (): Promise<any> => {
    try {
      const stats = tenantStats() ?? handleStats(DB_PATH);
      const vaultRepo = getSetting('vault_repo');
      const fts = readFtsHealth(totalDocs(stats));
      try {
        const vectorStats = await readVectorStats();
        return { ...stats, ...vectorStats, vector_status: vectorStatus(vectorStats), fts, fts_status: fts.status, fts_indexed: fts.indexed, vault_repo: vaultRepo };
      } catch (error) {
        return { ...stats, ...fallbackVector, vector_status: 'down', vector_error: errorMessage(error), fts, fts_status: fts.status, fts_indexed: fts.indexed, vault_repo: vaultRepo };
      }
    } catch (err) {
      if (isDbLockError(err)) return { total_docs: 0, by_type: {}, indexing: true, error: 'db temporarily unavailable' };
      throw err;
    }
  }, {
    response: statsResponseSchema(),
    detail: {
      tags: ['health'],
      menu: { group: 'tools', order: 50 },
      description: 'Returns document inventory and index progress along with vector collection metadata.',
      summary: 'Database and vector stats',
    },
  });
}
