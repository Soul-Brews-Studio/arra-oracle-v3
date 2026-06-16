import { Elysia } from 'elysia';
import { DB_PATH } from '../../config.ts';
import { getSetting, isDbLockError } from '../../db/index.ts';
import { handleStats } from '../../server/handlers.ts';
import { handleVectorStats } from '../../server/vector-handlers.ts';
import { tenantStats } from './tenant-stats.ts';

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
  detail: {
    tags: ['health'],
    menu: { group: 'tools', order: 50 },
    summary: 'Database and vector stats',
  },
});
