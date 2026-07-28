import { Elysia } from 'elysia';
import { DB_PATH } from '../../config.ts';
import { Database } from 'bun:sqlite';

export const progressEndpoint = new Elysia().get('/indexer/progress', async ({ set }) => {
  set.headers['Content-Type'] = 'text/event-stream';
  set.headers['Cache-Control'] = 'no-cache';
  set.headers['Connection'] = 'keep-alive';

  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream({
      async start(controller) {
        const sqlite = new Database(DB_PATH, { readonly: true });
        let done = false;

        while (!done) {
          try {
            const row = sqlite.prepare(
              'SELECT is_indexing, progress_current, progress_total, error, started_at, completed_at FROM indexing_status WHERE id = 1'
            ).get() as {
              is_indexing: number;
              progress_current: number;
              progress_total: number;
              error: string | null;
              started_at: number | null;
              completed_at: number | null;
            } | null;

            if (!row) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ status: 'idle', current: 0, total: 0 })}\n\n`));
              done = true;
              break;
            }

            const elapsed = row.started_at ? (Date.now() - row.started_at) / 1000 : 0;
            const docsPerSec = elapsed > 0 && row.progress_current > 0
              ? (row.progress_current / elapsed).toFixed(1)
              : '0';
            const remaining = row.progress_total - row.progress_current;
            const eta = Number(docsPerSec) > 0 ? Math.ceil(remaining / Number(docsPerSec)) : 0;

            const status = row.error
              ? 'error'
              : row.is_indexing
                ? 'indexing'
                : row.progress_current >= row.progress_total && row.progress_total > 0
                  ? 'completed'
                  : 'idle';

            const payload = {
              status,
              current: row.progress_current,
              total: row.progress_total,
              docsPerSec,
              eta,
              error: row.error,
            };

            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));

            if (status === 'completed' || status === 'error' || status === 'idle') {
              done = true;
              break;
            }

            await new Promise(r => setTimeout(r, 500));
          } catch {
            done = true;
          }
        }

        sqlite.close();
        controller.close();
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } }
  );
}, {
  detail: {
    tags: ['indexer'],
    summary: 'SSE stream of indexing progress',
  },
});
