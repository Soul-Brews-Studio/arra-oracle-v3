import { describe, expect, it } from 'bun:test';
import { handleIndexRetro } from '../index-retro.ts';

describe('oracle_index_retro', () => {
  it('rejects missing paths before invoking the indexer', async () => {
    let called = false;
    const result = await handleIndexRetro(
      { repoRoot: ' ', filePath: '' },
      async () => {
        called = true;
        return { ok: true as const, repoRoot: '/unused', filePath: '/unused', documents: 1 };
      },
    );

    expect(called).toBe(false);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('repoRoot');
    expect(result.content[0]?.text).toContain('filePath');
  });

  it('passes the exact repository and retro path to the owner indexer', async () => {
    const calls: Array<[string, string]> = [];
    const result = await handleIndexRetro(
      { repoRoot: '/oracle/root', filePath: '/oracle/root/ψ/memory/retrospectives/2026-08/18/test.md' },
      async (repoRoot, filePath) => {
        calls.push([repoRoot, filePath]);
        return { ok: true as const, repoRoot, filePath, documents: 3 };
      },
    );

    expect(calls).toEqual([[
      '/oracle/root',
      '/oracle/root/ψ/memory/retrospectives/2026-08/18/test.md',
    ]]);
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(result.content[0]?.text ?? '{}')).toEqual({
      ok: true,
      repoRoot: '/oracle/root',
      filePath: '/oracle/root/ψ/memory/retrospectives/2026-08/18/test.md',
      documents: 3,
    });
  });

  it('fails closed when the owner indexer rejects the path', async () => {
    const result = await handleIndexRetro(
      { repoRoot: '/oracle/root', filePath: '/tmp/not-a-retro.md' },
      async () => { throw new Error('Refusing to index non-retro file'); },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Refusing to index non-retro file');
  });
});
