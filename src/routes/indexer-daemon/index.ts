/**
 * Indexer daemon HTTP API — Elysia plugin (M3 of the indexer-CLI design).
 *
 * Ported from alpha's Hono `src/indexer/api.ts`. Same routes, same response
 * shapes, same status codes. The daemon entrypoint (`src/indexer/daemon.ts`)
 * wires the real db / models / event bus / shutdown primitives via the
 * `daemonApiPlugin(deps)` factory; tests wire mocks.
 *
 * Endpoints:
 *   POST /index            enqueue a job (per-model or all-models)
 *   GET  /jobs?status=&model=&limit=    list recent jobs
 *   GET  /events           SSE stream of worker events
 *   POST /drain            request graceful shutdown
 *   GET  /health           workers + queue depth + shutdown state
 *
 * Same trust model as Ollama — bind to 127.0.0.1 only at the daemon layer.
 *
 * Design: ψ/lab/indexer-cli/DESIGN.md (M3).
 */

import { Elysia, t } from 'elysia';
import type Database from 'bun:sqlite';
import { enqueueIndexJob, jobsByStatus } from '../../indexer/jobs.ts';
import type { WorkerEvent } from '../../indexer/worker.ts';

export interface DaemonApiDeps {
  db: Database;
  models: Record<string, { collection: string }>;
  isShuttingDown: () => boolean;
  requestShutdown: () => void;
  /** Subscribe to live worker events. Returns an unsubscribe function. */
  subscribe: (cb: (ev: WorkerEvent) => void) => () => void;
}

interface IndexingJobRow {
  id: string;
  doc_id: string;
  model_key: string;
  collection: string;
  status: string;
  attempts: number;
  created_at: number;
  claimed_at: number | null;
  finished_at: number | null;
  error: string | null;
}

/**
 * Build the Elysia plugin for the daemon API. Returns a plugin (Elysia
 * instance), not a function to call later — pass `deps` once at boot, then
 * `.use(daemonApiPlugin(deps))`.
 */
export function daemonApiPlugin(deps: DaemonApiDeps) {
  return new Elysia({ name: 'indexer-daemon' })
    .get('/health', () => {
      const counts = jobsByStatus(deps.db);
      const queueDepth: Record<string, number> = {};
      for (const row of counts) {
        if (row.status === 'pending' || row.status === 'claimed') {
          queueDepth[row.model_key] = (queueDepth[row.model_key] || 0) + row.count;
        }
      }
      return {
        status: 'ok',
        service: 'arra-indexer',
        shutting_down: deps.isShuttingDown(),
        queue_depth: queueDepth,
        models: Object.keys(deps.models),
      };
    })
    .post(
      '/index',
      ({ body, set }) => {
        if (deps.isShuttingDown()) {
          set.status = 503;
          return { error: 'shutting down' };
        }
        if (!body.doc_id || typeof body.doc_id !== 'string') {
          set.status = 400;
          return { error: 'doc_id required' };
        }
        const jobs = enqueueIndexJob(deps.db, {
          docId: body.doc_id,
          modelKey: body.model_key,
          models: deps.models,
        });
        return { jobs };
      },
      {
        body: t.Object({
          doc_id: t.Optional(t.String()),
          model_key: t.Optional(t.String()),
        }),
      },
    )
    .get(
      '/jobs',
      ({ query }) => {
        const status = query.status;
        const modelKey = query.model;
        const limit = Math.min(parseInt(query.limit || '100', 10) || 100, 1000);

        const where: string[] = [];
        const params: Array<string | number> = [];
        if (status) {
          where.push('status = ?');
          params.push(status);
        }
        if (modelKey) {
          where.push('model_key = ?');
          params.push(modelKey);
        }
        const sql = `SELECT id, doc_id, model_key, collection, status, attempts,
                            created_at, claimed_at, finished_at, error
                     FROM indexing_jobs
                     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                     ORDER BY created_at DESC
                     LIMIT ?`;
        params.push(limit);
        const rows = deps.db
          .query<IndexingJobRow, typeof params>(sql)
          .all(...params);
        return { jobs: rows, count: rows.length };
      },
      {
        query: t.Object({
          status: t.Optional(t.String()),
          model: t.Optional(t.String()),
          limit: t.Optional(t.String()),
        }),
      },
    )
    .get('/events', ({ set }) => {
      set.headers['Content-Type'] = 'text/event-stream';
      set.headers['Cache-Control'] = 'no-cache';
      set.headers['Connection'] = 'keep-alive';

      const encoder = new TextEncoder();

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          let aborted = false;
          let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

          const writeSSE = (event: string, data: string) => {
            if (aborted) return;
            try {
              controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
            } catch {
              aborted = true;
            }
          };

          const unsubscribe = deps.subscribe((ev) => {
            writeSSE(ev.type, JSON.stringify(ev));
          });

          const cleanup = () => {
            if (aborted) return;
            aborted = true;
            if (heartbeatTimer) clearInterval(heartbeatTimer);
            unsubscribe();
            try { controller.close(); } catch { /* already closed */ }
          };

          // Heartbeat to keep the connection alive AND to notice shutdown.
          heartbeatTimer = setInterval(() => {
            if (deps.isShuttingDown()) {
              cleanup();
              return;
            }
            writeSSE('heartbeat', '{}');
          }, 15_000);
        },
        cancel() {
          // Client disconnected — controller already closing.
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    })
    .post('/drain', () => {
      deps.requestShutdown();
      return { status: 'draining' };
    });
}

/**
 * Simple pub-sub bus for worker events. Daemon entrypoint creates one,
 * passes `publish` to each worker's `onEvent`, and `subscribe` to the API.
 */
export interface EventBus<E> {
  publish: (ev: E) => void;
  subscribe: (cb: (ev: E) => void) => () => void;
}

export function makeEventBus<E>(): EventBus<E> {
  const subs = new Set<(ev: E) => void>();
  return {
    publish: (ev) => {
      for (const cb of subs) {
        try { cb(ev); } catch { /* don't let one subscriber kill the others */ }
      }
    },
    subscribe: (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}
