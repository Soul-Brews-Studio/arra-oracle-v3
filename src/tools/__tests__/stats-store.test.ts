import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ORACLE_DATA_DIR } from '../../config.ts';
import { createDatabase } from '../../db/index.ts';
import { handleStats, resolveStatsStore } from '../stats.ts';
import type { ToolContext } from '../types.ts';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test('handleStats reports the canonical runtime data store', async () => {
  const connection = createDatabase(':memory:');
  const ctx = {
    db: connection.db,
    sqlite: connection.sqlite,
    repoRoot: ORACLE_DATA_DIR,
    vectorStore: { name: 'test-vector' },
    vectorStatus: 'connected',
    version: 'test-version',
  } as ToolContext;

  try {
    const response = await handleStats(ctx, {});
    const payload = JSON.parse(response.content[0]?.text ?? '{}') as Record<string, unknown>;
    expect(payload.store).toBe(realpathSync(ORACLE_DATA_DIR));
  } finally {
    connection.sqlite.close();
  }
});

test('resolveStatsStore canonicalizes a symlinked runtime directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'arra-stats-store-'));
  tempDirs.push(root);
  const store = mkdtempSync(join(tmpdir(), 'arra-stats-target-'));
  tempDirs.push(store);
  const alias = join(root, 'store');
  symlinkSync(store, alias);

  expect(resolveStatsStore(alias)).toBe(realpathSync(store));
});

test('resolveStatsStore fails closed without exposing the unresolved path', () => {
  const root = mkdtempSync(join(tmpdir(), 'arra-stats-missing-'));
  tempDirs.push(root);
  const missing = join(root, 'secret-token-value');

  expect(() => resolveStatsStore(missing)).toThrow('Unable to resolve Oracle data store');
  try {
    resolveStatsStore(missing);
  } catch (error) {
    expect((error as Error).message).toBe('Unable to resolve Oracle data store');
    expect((error as Error).message).not.toContain(missing);
    expect((error as Error).message).not.toContain('secret-token-value');
  }
});
