import { afterAll, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createDatabase } from '../../../src/db/create.ts';
import { oracleMemories } from '../../../src/db/schema.ts';
import { createTenantFetch, TENANT_HEADER } from '../../../src/middleware/tenant.ts';
import { createMemoryStatsEndpoint, memoryStats } from '../../../src/routes/memory/stats.ts';

const connection = createDatabase(':memory:');
const now = Date.parse('2026-06-17T00:00:00.000Z');
const app = new Elysia({ prefix: '/api' }).use(createMemoryStatsEndpoint(connection.db));
const fetcher = createTenantFetch((request) => app.handle(request));

afterAll(() => connection.storage.close());

function addMemory(input: {
  id: string; tenantId?: string; updatedAt: number; tags?: string[]; source?: string | null;
  validFrom?: number | null; validTo?: number | null; supersededBy?: string | null; supersededAt?: number | null;
}) {
  connection.db.insert(oracleMemories).values({
    id: input.id,
    tenantId: input.tenantId ?? 'tenant-a',
    content: `${input.id} memory stats fixture`,
    title: input.id,
    tags: JSON.stringify(input.tags ?? []),
    source: input.source ?? null,
    validFrom: input.validFrom ?? null,
    validTo: input.validTo ?? null,
    supersededBy: input.supersededBy ?? null,
    supersededAt: input.supersededAt ?? null,
    createdAt: input.updatedAt - 1000,
    updatedAt: input.updatedAt,
  }).run();
}

addMemory({ id: 'hot', updatedAt: now - 86_400_000, tags: ['deploy'], source: 'docs/a.md', validFrom: now - 10 });
addMemory({ id: 'warm', updatedAt: now - 20 * 86_400_000, tags: ['deploy'] });
addMemory({ id: 'cold-old', updatedAt: now - 90 * 86_400_000, supersededBy: 'warm', supersededAt: now - 1 });
addMemory({ id: 'tenant-b', tenantId: 'tenant-b', updatedAt: now - 86_400_000, tags: ['other'], source: 'docs/b.md' });

describe('GET /api/v1/memory/stats', () => {
  test('summarizes heat, confidence, supersede depth, and valid-time coverage', () => {
    const stats = memoryStats(connection.db, new Date(now));

    expect(stats).toMatchObject({ total: 4, active: 3, superseded: 1 });
    expect(stats.heat_distribution).toEqual({ hot: 2, warm: 1, cold: 1 });
    expect(stats.confidence_histogram.high + stats.confidence_histogram.medium + stats.confidence_histogram.low).toBe(4);
    expect(stats.supersede_chain).toEqual({ linked: 1, max_depth: 1 });
    expect(stats.valid_time_coverage).toEqual({ count: 1, percent: 0.25 });
  });

  test('HTTP endpoint is tenant scoped', async () => {
    const res = await fetcher(new Request('http://local/api/memory/stats', {
      headers: { [TENANT_HEADER]: 'tenant-b' },
    }));
    const body = await res.json() as Record<string, any>;

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ total: 1, active: 1, superseded: 0 });
    expect(body.valid_time_coverage).toEqual({ count: 0, percent: 0 });
  });
});
