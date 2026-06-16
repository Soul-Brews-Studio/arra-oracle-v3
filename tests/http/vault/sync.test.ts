import { describe, expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createVaultSyncRoute } from '../../../src/routes/vault/sync.ts';
import type { MigrateResult } from '../../../src/vault/migrate.ts';

const emptyMigrate: MigrateResult = {
  reposFound: 0,
  filesCopied: 0,
  repos: [],
  skipped: [],
  symlinked: [],
};

function appWith(migrate: (opts: { dryRun: boolean }) => MigrateResult, spawnIndexer = mock(() => {})) {
  return new Elysia({ prefix: '/api/vault' })
    .use(createVaultSyncRoute({ migrate, spawnIndexer }));
}

function post(app: Elysia, body: unknown) {
  return app.handle(new Request('http://local/api/vault/sync', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

describe('vault sync HTTP route', () => {
  test('dry-run sync returns migrate result without spawning reindex', async () => {
    const migrate = mock(() => ({ ...emptyMigrate, reposFound: 2, filesCopied: 5 }));
    const spawnIndexer = mock(() => {});
    const res = await post(appWith(migrate, spawnIndexer), { dryRun: true, reindex: true });
    const body = await res.json() as Record<string, any>;

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.dryRun).toBe(true);
    expect(body.reindex).toBe(false);
    expect(body.migrate.filesCopied).toBe(5);
    expect(spawnIndexer).not.toHaveBeenCalled();
  });

  test('reindex spawns only when copied files exist', async () => {
    const migrate = mock(() => ({ ...emptyMigrate, filesCopied: 1 }));
    const spawnIndexer = mock(() => {});
    const res = await post(appWith(migrate, spawnIndexer), { reindex: true });
    const body = await res.json() as Record<string, any>;

    expect(res.status).toBe(200);
    expect(body.reindex).toBe(true);
    expect(spawnIndexer).toHaveBeenCalledTimes(1);
  });

  test('migrate failures surface as 500 JSON', async () => {
    const migrate = mock(() => { throw new Error('vault not initialized'); });
    const res = await post(appWith(migrate), {});
    const body = await res.json() as Record<string, any>;

    expect(res.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.error).toContain('vault not initialized');
  });
});
