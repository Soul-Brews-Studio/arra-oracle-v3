import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { handleIndexRetro } from '../index-retro.ts';

const tempDirs: string[] = [];
const priorBoundRoot = process.env.ORACLE_MEMORY_OWNER_ROOT;

afterEach(() => {
  if (priorBoundRoot === undefined) delete process.env.ORACLE_MEMORY_OWNER_ROOT;
  else process.env.ORACLE_MEMORY_OWNER_ROOT = priorBoundRoot;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeTempRoot(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function indexUnder(repoRoot: string): Promise<{ isError?: boolean; text: string; indexerCalled: boolean }> {
  let indexerCalled = false;
  const result = await handleIndexRetro(
    { repoRoot, filePath: join(repoRoot, 'ψ/memory/retrospectives/2026-08/19/seam.md') },
    async (root, filePath) => {
      indexerCalled = true;
      return { ok: true as const, repoRoot: root, filePath, documents: 1 };
    },
  );
  return { isError: result.isError, text: result.content[0]?.text ?? '', indexerCalled };
}

describe('oracle_index_retro memory-owner seam (birth spec v5 D1)', () => {
  it('rejects a repoRoot outside the bound memory owner without invoking the indexer', async () => {
    const boundRoot = makeTempRoot('arra-seam-owner-');
    const foreignRoot = makeTempRoot('arra-seam-foreign-');
    process.env.ORACLE_MEMORY_OWNER_ROOT = boundRoot;

    const outcome = await indexUnder(foreignRoot);

    expect(outcome.indexerCalled).toBe(false);
    expect(outcome.isError).toBe(true);
    expect(outcome.text).toContain('ORACLE_MEMORY_OWNER_ROOT');
    expect(outcome.text).toContain(boundRoot);
  });

  it('accepts the bound root itself, including through a differently spelled path', async () => {
    const boundRoot = makeTempRoot('arra-seam-owner-');
    process.env.ORACLE_MEMORY_OWNER_ROOT = boundRoot;

    const outcome = await indexUnder(join(boundRoot, '.', ''));

    expect(outcome.indexerCalled).toBe(true);
    expect(outcome.isError).not.toBe(true);
  });

  it('rejects an unresolvable repoRoot while the seam is bound (fail closed)', async () => {
    const boundRoot = makeTempRoot('arra-seam-owner-');
    process.env.ORACLE_MEMORY_OWNER_ROOT = boundRoot;

    const outcome = await indexUnder(join(boundRoot, 'does-not-exist'));

    expect(outcome.indexerCalled).toBe(false);
    expect(outcome.isError).toBe(true);
  });

  it('keeps legacy behavior when no seam is bound', async () => {
    delete process.env.ORACLE_MEMORY_OWNER_ROOT;
    const anyRoot = makeTempRoot('arra-seam-legacy-');

    const outcome = await indexUnder(anyRoot);

    expect(outcome.indexerCalled).toBe(true);
    expect(outcome.isError).not.toBe(true);
  });
});
