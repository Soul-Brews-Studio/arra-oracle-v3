import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Elysia } from 'elysia';

const previousDataDir = process.env.ORACLE_DATA_DIR;
const previousDbPath = process.env.ORACLE_DB_PATH;
const tmp = mkdtempSync(join(tmpdir(), 'arra-plugin-metadata-'));

process.env.ORACLE_DATA_DIR = tmp;
process.env.ORACLE_DB_PATH = join(tmp, 'oracle.db');

const { createDrizzleSqliteBackend } = await import('../../../src/storage/drizzle-sqlite.ts');
const { registeredCanvasPluginMetadataRegistry } = await import('../../../src/routes/plugins/canvas-metadata-db.ts');
const { createTenantFetch, DEFAULT_TENANT_ID, TENANT_HEADER } = await import('../../../src/middleware/tenant.ts');
const { createPluginsRouter } = await import('../../../src/routes/plugins/index.ts');

const storage = createDrizzleSqliteBackend({ dbPath: process.env.ORACLE_DB_PATH });
const app = new Elysia().use(createPluginsRouter({
  registry: () => { throw new Error('installed plugin registry should not load canvas metadata'); },
  canvasMetadataRegistry: () => registeredCanvasPluginMetadataRegistry(storage.db),
}));

type CanvasRegistry = {
  kind: string;
  count: number;
  plugins: Array<{ id: string; label: string; kind: string; renderer: string }>;
  standalone: { host: string };
};

function canvasRequest(tenantId?: string) {
  const headers = tenantId ? { [TENANT_HEADER]: tenantId } : undefined;
  return createTenantFetch((request) => app.handle(request))(
    new Request('http://local/api/plugins?kind=canvas', { headers }),
  );
}

async function fetchCanvasRegistry(tenantId?: string): Promise<CanvasRegistry> {
  const res = await canvasRequest(tenantId);
  expect(res.status).toBe(200);
  return await res.json() as CanvasRegistry;
}

function rowCount(tenantId: string): number {
  const row = storage.sqlite.query(
    'SELECT COUNT(*) as count FROM plugin_metadata WHERE tenant_id = ? AND surface = ?',
  ).get(tenantId, 'canvas') as { count: number };
  return row.count;
}

function renameWave(tenantId: string, label: string): void {
  storage.sqlite.prepare(`
    UPDATE plugin_metadata SET label = ?, updated_at = ?
    WHERE tenant_id = ? AND surface = 'canvas' AND plugin_id = 'wave'
  `).run(label, Date.now(), tenantId);
}

afterAll(() => {
  storage.close();
  if (previousDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = previousDataDir;
  if (previousDbPath === undefined) delete process.env.ORACLE_DB_PATH;
  else process.env.ORACLE_DB_PATH = previousDbPath;
  rmSync(tmp, { recursive: true, force: true });
});

describe('GET /api/plugins?kind=canvas metadata registry', () => {
  test('seeds current canvas plugins into the default tenant database', async () => {
    const body = await fetchCanvasRegistry();

    expect(body.kind).toBe('canvas');
    expect(body.count).toBe(9);
    expect(body.plugins).toHaveLength(9);
    expect(rowCount(DEFAULT_TENANT_ID)).toBe(9);
    expect(body.plugins.map((plugin) => plugin.id)).toEqual([
      'cube', 'galaxy', 'torus', 'graph3d', 'solar', 'wave', 'map3d', 'map', 'planets',
    ]);
    expect(body.plugins).toContainEqual(expect.objectContaining({
      id: 'map', label: 'Knowledge Map', kind: 'react', renderer: 'React',
    }));
  });

  test('reads tenant-scoped plugin metadata from DB without leaking labels', async () => {
    const tenantA = 'plugin-metadata-a';
    const tenantB = 'plugin-metadata-b';
    await fetchCanvasRegistry(tenantA);
    renameWave(tenantA, 'Tenant A Wave');

    const bodyA = await fetchCanvasRegistry(tenantA);
    const bodyB = await fetchCanvasRegistry(tenantB);

    expect(rowCount(tenantA)).toBe(9);
    expect(rowCount(tenantB)).toBe(9);
    expect(bodyA.plugins.find((plugin) => plugin.id === 'wave')?.label).toBe('Tenant A Wave');
    expect(bodyB.plugins.find((plugin) => plugin.id === 'wave')?.label).toBe('Wave');
  });
});
