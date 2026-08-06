import { expect, test } from 'bun:test';
import { createHealthRoutes } from '../../../src/routes/health/index.ts';

test('GET /api/health exposes entity sidecar coverage ratio and worker gate', async () => {
  const previous = process.env.ORACLE_ENTITY_BACKFILL;
  delete process.env.ORACLE_ENTITY_BACKFILL;
  try {
    const app = createHealthRoutes({
      pluginCount: 1,
      uptimeSeconds: () => 4,
      vectorHealth: async () => ({ status: 'ok', engines: [], checked_at: 'now' }),
      vectorServerHealth: async () => ({ configured: false, status: 'unconfigured' }),
      embeddingProviderSelection: { provider: 'none', source: 'env', explicit: true },
      entityCoverage: () => ({
        docsIndexed: 4,
        docsWithEntities: 3,
        docsMissingEntities: 1,
        ratio: 0.75,
        tenantId: 'tenant-a',
        checkedAt: '2026-07-05T00:00:00.000Z',
      }),
    });

    const res = await app.handle(new Request('http://local/api/health'));
    const body = await res.json() as Record<string, any>;

    expect(res.status).toBe(200);
    expect(body.subsystems.entities).toMatchObject({
      status: 'healthy',
      label: 'entity sidecar coverage',
      data: { docsIndexed: 4, docsWithEntities: 3, docsMissingEntities: 1, ratio: 0.75, percent: 75 },
    });
    expect(body.entities.coverage).toMatchObject({ docsIndexed: 4, docsWithEntities: 3, tenantId: 'tenant-a' });
    expect(body.entities.backfillWorker).toMatchObject({ enabled: false, running: false, disabledReason: 'set ORACLE_ENTITY_BACKFILL=1 to enable' });
  } finally {
    if (previous === undefined) delete process.env.ORACLE_ENTITY_BACKFILL;
    else process.env.ORACLE_ENTITY_BACKFILL = previous;
  }
});
