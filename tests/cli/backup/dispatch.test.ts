import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { runCli } from '../_run.ts';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.length = 0;
});

function isolatedEnv(): Record<string, string> {
  const root = mkdtempSync(join(tmpdir(), 'arra-backup-cli-'));
  roots.push(root);
  return {
    HOME: join(root, 'home'),
    ORACLE_DATA_DIR: join(root, 'data'),
    ORACLE_REPO_ROOT: root,
    ORACLE_DB_PATH: join(root, 'data', 'oracle.db'),
  };
}

describe('backup CLI dispatcher', () => {
  test('writes an SQL dump through arra-cli backup --out-dir', async () => {
    const env = isolatedEnv();
    const outDir = join(env.ORACLE_DATA_DIR!, 'custom-backups');
    const seed = await runCli(['seed'], env);
    const backup = await runCli(['backup', '--out-dir', outDir], env);
    const result = JSON.parse(backup.stdout);

    expect(seed.code).toBe(0);
    expect(backup.code).toBe(0);
    expect(backup.stderr).toBe('');
    expect(result.path.startsWith(outDir)).toBe(true);
    expect(basename(result.path)).toMatch(/^arra-oracle-.*\.sql$/);
    expect(existsSync(result.path)).toBe(true);

    const sql = readFileSync(result.path, 'utf8');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "menu_items"');
    expect(sql).toContain('/dev/vector-search');
    expect(sql).toContain('seed-learning-menu-aggregation');
  }, 15_000);
});
