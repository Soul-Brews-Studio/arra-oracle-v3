/**
 * Indexer daemon HTTP API — M3 of the indexer-CLI design.
 *
 * Hono app factory. Pure dependency-injected: the daemon entrypoint
 * (daemon.ts) wires the real db / models / event bus / shutdown
 * primitives; tests wire mocks.
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

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type Database from 'bun:sqlite';
import { enqueueIndexJob, jobsByStatus } from './jobs.ts';
import type { WorkerEvent } from './worker.ts';

export interface ApiDeps {
  db: Database;
  models: Record<string, { collection: string }>;
  isShuttingDown: () => boolean;
  requestShutdown: () => void;
  /** Subscribe to live worker events. Returns an unsubscribe function. */
  subscribe: (cb: (ev: WorkerEvent) => void) => () => void;
}

interface IndexBody {
  doc_id?: string;
  model_key?: string;
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

export function createDaemonApp(deps: ApiDeps): Hono {
  const app = new Hono();

  app.get('/health', (c) => {
    const counts = jobsByStatus(deps.db);
    const queueDepth: Record<string, number> = {};
    for (const row of counts) {
      if (row.status === 'pending' || row.status === 'claimed') {
        queueDepth[row.model_key] = (queueDepth[row.model_key] || 0) + row.count;
      }
    }
    return c.json({
      status: 'ok',
      service: 'arra-indexer',
      shutting_down: deps.isShuttingDown(),
      queue_depth: queueDepth,
      models: Object.keys(deps.models),
    });
  });

  app.post('/index', async (c) => {
    if (deps.isShuttingDown()) {
      return c.json({ error: 'shutting down' }, 503);
    }
    let body: IndexBody;
    try {
      body = await c.req.json<IndexBody>();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    if (!body.doc_id || typeof body.doc_id !== 'string') {
      return c.json({ error: 'doc_id required' }, 400);
    }
    const jobs = enqueueIndexJob(deps.db, {
      docId: body.doc_id,
      modelKey: body.model_key,
      models: deps.models,
    });
    return c.json({ jobs });
  });

  app.get('/jobs', (c) => {
    const status = c.req.query('status');
    const modelKey = c.req.query('model');
    const limit = Math.min(parseInt(c.req.query('limit') || '100', 10) || 100, 1000);

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
    return c.json({ jobs: rows, count: rows.length });
  });

  app.get('/events', (c) => {
    return streamSSE(c, async (stream) => {
      let aborted = false;
      const unsubscribe = deps.subscribe(async (ev) => {
        if (aborted) return;
        await stream.writeSSE({
          event: ev.type,
          data: JSON.stringify(ev),
        });
      });
      stream.onAbort(() => {
        aborted = true;
        unsubscribe();
      });
      // Heartbeat to keep the connection alive AND to notice shutdown.
      while (!aborted && !deps.isShuttingDown()) {
        await stream.sleep(15_000);
        if (aborted) break;
        await stream.writeSSE({ event: 'heartbeat', data: '{}' });
      }
      unsubscribe();
    });
  });

  app.post('/drain', (c) => {
    deps.requestShutdown();
    return c.json({ status: 'draining' });
  });

  return app;
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
