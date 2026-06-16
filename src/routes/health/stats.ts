import { Elysia, t } from 'elysia';
import { DB_PATH } from '../../config.ts';
import { getSetting, isDbLockError } from '../../db/index.ts';
import { handleStats } from '../../server/handlers.ts';
import { handleVectorStats } from '../../server/vector-handlers.ts';
import { tenantStats } from './tenant-stats.ts';

const StatsResponseSchema = t.Object({
  total: t.Optional(t.Number()),
  total_docs: t.Optional(t.Number()),
  by_type: t.Record(t.String(), t.Number()),
  is_indexing: t.Optional(t.Boolean()),
  indexing: t.Optional(t.Boolean()),
  vector: t.Optional(t.Object({
    enabled: t.Boolean(),
    count: t.Number(),
    collection: t.String(),
  })),
  database: t.Optional(t.String()),
  vault_repo: t.Optional(t.Nullable(t.String())),
  error: t.Optional(t.String()),
});

export const statsEndpoint = new Elysia().get('/stats', async () => {
  try {
    const stats = tenantStats() ?? handleStats(DB_PATH);
    const vaultRepo = getSetting('vault_repo');
    let vectorStats = { vector: { enabled: false, count: 0, collection: 'oracle_knowledge' } };
    try {
      vectorStats = await handleVectorStats();
    } catch { /* vector unavailable */ }
    return { ...stats, ...vectorStats, vault_repo: vaultRepo };
  } catch (err) {
    if (isDbLockError(err)) {
      return { total_docs: 0, by_type: {}, indexing: true, error: 'db temporarily unavailable' };
    }
    throw err;
  }
}, {
    response: StatsResponseSchema,
    detail: {
      tags: ['health'],
      menu: { group: 'tools', order: 50 },
      description: 'Returns document inventory and index progress along with vector collection metadata.',
      summary: 'Database and vector stats',
    },
  });
