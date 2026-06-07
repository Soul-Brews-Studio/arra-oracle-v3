import { Elysia, t } from 'elysia';
import { runOracleReindex, resolveIndexerRepoRoot } from '../../indexer/runner.ts';
import { indexRetrospectives, indexRetroFile } from '../../indexer/retro-index.ts';

type ReindexResult =
  | Awaited<ReturnType<typeof runOracleReindex>>
  | Awaited<ReturnType<typeof indexRetrospectives>>
  | Awaited<ReturnType<typeof indexRetroFile>>;

export interface ReindexDeps {
  resolveRepoRoot: (repoRoot?: string | null) => string;
  runFull: (opts: { repoRoot?: string | null; append?: boolean }) => Promise<ReindexResult>;
  runRetros: (repoRoot: string) => Promise<ReindexResult>;
  runRetroFile: (repoRoot: string, filePath: string) => Promise<ReindexResult>;
}

const defaultDeps: ReindexDeps = {
  resolveRepoRoot: resolveIndexerRepoRoot,
  runFull: runOracleReindex,
  runRetros: indexRetrospectives,
  runRetroFile: indexRetroFile,
};

export function createReindexRoute(deps: ReindexDeps = defaultDeps) {
  let activeJob: { id: string; startedAt: string } | null = null;

  return new Elysia().post('/indexer/reindex', async ({ body, set }) => {
    const requested = body ?? {};
    const scope = requested.scope ?? 'all';
    const wait = requested.wait !== false;
    const append = requested.append === true;
    const repoRoot = deps.resolveRepoRoot(requested.repoRoot);
    const jobId = `reindex-${Date.now()}`;

    if (activeJob) {
      set.status = 409;
      return { ok: false, error: 'Reindex already running', activeJob };
    }

    const run = async () => {
      if (scope === 'retros') return deps.runRetros(repoRoot);
      if (scope === 'retro-file') {
        if (!requested.filePath) throw new Error('filePath is required for scope=retro-file');
        return deps.runRetroFile(repoRoot, requested.filePath);
      }
      return deps.runFull({ repoRoot, append });
    };

    activeJob = { id: jobId, startedAt: new Date().toISOString() };
    const task = run()
      .then((result) => ({ jobId, status: 'complete' as const, ...result }))
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false as const, jobId, status: 'error' as const, repoRoot, error: message };
      })
      .finally(() => {
        activeJob = null;
      });

    if (wait) return await task;

    // Ensure background failures are observed by the task catch above.
    void task;
    return { ok: true, jobId, status: 'started', repoRoot, scope, append };
  }, {
    body: t.Optional(t.Object({
      repoRoot: t.Optional(t.String()),
      scope: t.Optional(t.Union([
        t.Literal('all'),
        t.Literal('retros'),
        t.Literal('retro-file'),
      ])),
      filePath: t.Optional(t.String()),
      wait: t.Optional(t.Boolean()),
      append: t.Optional(t.Boolean()),
    })),
    detail: {
      tags: ['indexer'],
      summary: 'Run SQLite/FTS reindex from the server process',
    },
  });
}

export const reindexEndpoint = createReindexRoute();
