import { describe, it, expect, mock } from 'bun:test';
import { Elysia } from 'elysia';
import { createReindexRoute } from '../reindex.ts';

function post(app: Elysia, body: unknown) {
  return app.handle(new Request('http://localhost/indexer/reindex', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

describe('POST /indexer/reindex', () => {
  it('runs the full reindex by default and waits for completion', async () => {
    const runFull = mock(async ({ repoRoot }: { repoRoot?: string | null }) => ({ ok: true as const, repoRoot: repoRoot ?? '/repo' }));
    const runRetros = mock(async (repoRoot: string) => ({ ok: true as const, repoRoot, documents: 0 }));
    const runRetroFile = mock(async (repoRoot: string, filePath: string) => ({ ok: true as const, repoRoot, filePath, documents: 0 }));
    const app = new Elysia().use(createReindexRoute({
      resolveRepoRoot: () => '/repo',
      runFull,
      runRetros,
      runRetroFile,
    }));

    const res = await post(app, {});
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.status).toBe('complete');
    expect(body.repoRoot).toBe('/repo');
    expect(runFull).toHaveBeenCalledTimes(1);
    expect(runRetros).not.toHaveBeenCalled();
  });

  it('supports retrospective-only indexing without full smart-delete', async () => {
    const runFull = mock(async ({ repoRoot }: { repoRoot?: string | null }) => ({ ok: true as const, repoRoot: repoRoot ?? '/repo' }));
    const runRetros = mock(async (repoRoot: string) => ({ ok: true as const, repoRoot, documents: 3 }));
    const runRetroFile = mock(async (repoRoot: string, filePath: string) => ({ ok: true as const, repoRoot, filePath, documents: 0 }));
    const app = new Elysia().use(createReindexRoute({
      resolveRepoRoot: () => '/oracle',
      runFull,
      runRetros,
      runRetroFile,
    }));

    const res = await post(app, { scope: 'retros' });
    const body = await res.json() as any;

    expect(body.ok).toBe(true);
    expect(body.documents).toBe(3);
    expect(body.repoRoot).toBe('/oracle');
    expect(runRetros).toHaveBeenCalledTimes(1);
    expect(runFull).not.toHaveBeenCalled();
  });

  it('returns a 409 while a non-waiting job is active', async () => {
    let release!: () => void;
    const blocker = new Promise<void>(resolve => { release = resolve; });
    const runFull = mock(async ({ repoRoot }: { repoRoot?: string | null }) => {
      await blocker;
      return { ok: true as const, repoRoot: repoRoot ?? '/repo' };
    });
    const runRetros = mock(async (repoRoot: string) => ({ ok: true as const, repoRoot, documents: 0 }));
    const runRetroFile = mock(async (repoRoot: string, filePath: string) => ({ ok: true as const, repoRoot, filePath, documents: 0 }));
    const app = new Elysia().use(createReindexRoute({
      resolveRepoRoot: () => '/repo',
      runFull,
      runRetros,
      runRetroFile,
    }));

    const first = await post(app, { wait: false });
    expect(first.status).toBe(200);

    const second = await post(app, {});
    const body = await second.json() as any;
    expect(second.status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.error).toContain('Reindex already running');

    release();
    await new Promise(resolve => setTimeout(resolve, 0));
  });
});
