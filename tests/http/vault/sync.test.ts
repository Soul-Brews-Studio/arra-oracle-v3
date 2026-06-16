import fs from 'fs';
import os from 'os';
import path from 'path';
import { beforeAll, describe, expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createTenantFetch, TENANT_HEADER } from '../../../src/middleware/tenant.ts';

type MigrateOptions = { dryRun: boolean; symlink?: boolean; tenantId?: string };
interface MigrateResult {
  reposFound: number;
  filesCopied: number;
  repos: Array<{ repoPath: string; project: string; fileCount: number }>;
  skipped: string[];
  symlinked: string[];
}

type VaultRouteFactory = (deps: {
  migrate: (opts: MigrateOptions) => MigrateResult;
  spawnIndexer: () => void;
}) => Elysia;

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-vault-http-'));
let createVaultSyncRoute: VaultRouteFactory;
let projectMatchesTenant: (project: string, tenantId: string) => boolean;

beforeAll(async () => {
  process.env.ORACLE_DATA_DIR = tempRoot;
  process.env.ORACLE_DB_PATH = path.join(tempRoot, 'oracle.db');
  ({ createVaultSyncRoute } = await import('../../../src/routes/vault/sync.ts'));
  ({ projectMatchesTenant } = await import('../../../src/vault/migrate.ts'));
});

const emptyMigrate: MigrateResult = {
  reposFound: 0,
  filesCopied: 0,
  repos: [],
  skipped: [],
  symlinked: [],
};

function appWith(migrate: (opts: MigrateOptions) => MigrateResult, spawnIndexer = mock(() => {})) {
  return new Elysia({ prefix: '/api/vault' }).use(createVaultSyncRoute({ migrate, spawnIndexer }));
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

  test('reindex spawn failures keep completed sync result visible', async () => {
    const migrate = mock(() => ({ ...emptyMigrate, filesCopied: 1 }));
    const spawnIndexer = mock(() => {
      throw new Error('spawn unavailable');
    });
    const res = await post(appWith(migrate, spawnIndexer), { reindex: true });
    const body = await res.json() as Record<string, any>;

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.reindex).toBe(false);
    expect(body.reindexError).toBe('spawn unavailable');
    expect(body.migrate.filesCopied).toBe(1);
  });

  test('matches vault projects to tenant ids before migration filtering', () => {
    expect(projectMatchesTenant('github.com/soul-brews-studio/arra-oracle-v3', 'soul-brews-studio')).toBe(true);
    expect(projectMatchesTenant('tenant-a', 'tenant-a')).toBe(true);
    expect(projectMatchesTenant('github.com/tenant-b/oracle', 'tenant-a')).toBe(false);
  });

  test('passes resolved tenant to migrate and returns tenant scope', async () => {
    const migrate = mock((opts: MigrateOptions) => ({ ...emptyMigrate, reposFound: opts.tenantId ? 1 : 0 }));
    const fetcher = createTenantFetch((request) => appWith(migrate).handle(request));
    const res = await fetcher(new Request('http://local/api/vault/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json', [TENANT_HEADER]: 'tenant-a' },
      body: JSON.stringify({ dryRun: true }),
    }));
    const body = await res.json() as Record<string, any>;

    expect(res.status).toBe(200);
    expect(migrate).toHaveBeenCalledWith({ dryRun: true, tenantId: 'tenant-a' });
    expect(body.tenant).toEqual({ id: 'tenant-a', scope: 'vault_project' });
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
