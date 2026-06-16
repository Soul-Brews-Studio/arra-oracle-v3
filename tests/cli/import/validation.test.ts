import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../_run.ts';

const roots: string[] = [];

function isolatedEnv(): Record<string, string> {
  const root = mkdtempSync(join(tmpdir(), 'arra-import-cli-'));
  roots.push(root);
  return {
    HOME: join(root, 'home'),
    ORACLE_DATA_DIR: join(root, 'data'),
    ORACLE_REPO_ROOT: root,
    ORACLE_DB_PATH: join(root, 'data', 'oracle.db'),
  };
}

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.length = 0;
});

describe('import CLI validation', () => {
  test('rejects missing values and unknown options before reading stdin', async () => {
    const cases = [
      { args: ['import', '--format'], error: 'missing value for --format' },
      { args: ['import', '--format='], error: 'missing value for --format' },
      { args: ['import', '--in'], error: 'missing value for --in' },
      { args: ['import', '--unknown'], error: 'unknown import option: --unknown' },
      { args: ['import', '--format', 'yaml'], error: 'unsupported format: yaml' },
    ];

    for (const item of cases) {
      const result = await runCli(item.args, isolatedEnv());
      expect(result.code).toBe(1);
      expect(result.stderr).toContain(item.error);
    }
  }, 15_000);
});
