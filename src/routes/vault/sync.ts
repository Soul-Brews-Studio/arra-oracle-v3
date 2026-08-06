/**
 * POST /api/vault/sync — short-term fix for #926.
 *
 * Calls `migrate()` to pull every ghq repo's ψ/ into the aggregate vault
 * (what `oracle-vault migrate` does on the CLI), then optionally triggers
 * a background reindex so /api/list?type=retro surfaces fresh entries.
 *
 * Longer fix: multi-root indexer scan or push-on-save from /rrr writes.
 */

import { Elysia, t } from 'elysia';
import { migrate as runMigrate, type MigrateOptions, type MigrateResult } from '../../vault/migrate.ts';
import { currentTenantId } from '../../middleware/tenant.ts';

export interface SyncDeps {
  migrate: (opts: MigrateOptions) => MigrateResult;
  spawnIndexer: () => void;
}

const defaultDeps: SyncDeps = {
  migrate: runMigrate,
  spawnIndexer: () => {
    Bun.spawn(['bun', 'run', 'src/indexer/cli.ts'], {
      cwd: process.cwd(),
      stdout: 'inherit',
      stderr: 'inherit',
    });
  },
};

export function createVaultSyncRoute(deps: SyncDeps = defaultDeps) {
  return new Elysia().post(
    '/sync',
    ({ body, set }) => {
      const dryRun = body?.dryRun === true;
      const reindex = body?.reindex === true;

      try {
        const tenantId = currentTenantId();
        const migrateOpts = tenantId ? { dryRun, tenantId } : { dryRun };
        const result = deps.migrate(migrateOpts);

        let reindexSpawned = false;
        let reindexError: string | undefined;
        if (reindex && !dryRun && result.filesCopied > 0) {
          try {
            deps.spawnIndexer();
            reindexSpawned = true;
          } catch (err) {
            reindexError = err instanceof Error ? err.message : String(err);
          }
        }

        return {
          ok: true,
          dryRun,
          reindex: reindexSpawned,
          reindexError,
          tenant: tenantId ? { id: tenantId, scope: 'vault_project' } : undefined,
          migrate: result,
        };
      } catch (err) {
        set.status = 500;
        return { ok: false, error: (err as Error).message };
      }
    },
    {
      body: t.Optional(
        t.Object({
          dryRun: t.Optional(t.Boolean()),
          reindex: t.Optional(t.Boolean()),
        }),
      ),
      detail: {
        tags: ['vault'],
        menu: { group: 'admin', order: 950 },
        summary:
          'Pull all ghq ψ/ dirs into the aggregate vault (short-term #926 fix); optional background reindex',
      },
    },
  );
}

export const vaultSyncRoute = createVaultSyncRoute();
