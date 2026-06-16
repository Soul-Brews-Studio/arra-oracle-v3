import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../_run.ts';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.length = 0;
});

function isolatedEnv(): Record<string, string> {
  const root = mkdtempSync(join(tmpdir(), 'arra-seed-cli-'));
  roots.push(root);
  return { HOME: join(root, 'home'), ORACLE_DATA_DIR: join(root, 'data'), ORACLE_REPO_ROOT: root };
}

describe('seed CLI dispatcher', () => {
  test('runs the development seed command from arra-cli', async () => {
    const result = await runCli(['seed'], isolatedEnv());
    const payload = JSON.parse(result.stdout);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(payload.menu.inserted).toBeGreaterThan(0);
    expect(payload.learn.documentsInserted).toBeGreaterThan(0);
  }, 15_000);
});
