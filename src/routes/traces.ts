/**
 * Trace Routes — /api/traces/*, linking, chaining
 */

import type { Hono } from 'hono';
import {
  listTraces,
  getTrace,
  getTraceChain,
  linkTraces,
  unlinkTraces,
  getTraceLinkedChain
} from '../trace/handler.ts';

export function registerTraceRoutes(app: Hono) {
  app.get('/api/traces', (c) => {
    const query = c.req.query('query');
    const status = c.req.query('status');
    const project = c.req.query('project');
    const limit = parseInt(c.req.query('limit') || '50');
    const offset = parseInt(c.req.query('offset') || '0');

    const result = listTraces({
      query: query || undefined,
      status: status as 'raw' | 'reviewed' | 'distilled' | undefined,
      project: project || undefined,
      limit,
      offset
    });

    return c.json(result);
  });

  app.get('/api/traces/:id', (c) => {
    const traceId = c.req.param('id');
    const trace = getTrace(traceId);

    if (!trace) {
      return c.json({ error: 'Trace not found' }, 404);
    }

    return c.json(trace);
  });

  app.get('/api/traces/:id/chain', (c) => {
    const traceId = c.req.param('id');
    const direction = c.req.query('direction') as 'up' | 'down' | 'both' || 'both';

    const chain = getTraceChain(traceId, direction);
    return c.json(chain);
  });

  // Link traces: POST /api/traces/:prevId/link { nextId: "..." }
  app.post('/api/traces/:prevId/link', async (c) => {
    try {
      const prevId = c.req.param('prevId');
      const { nextId } = await c.req.json();

      if (!nextId) {
        return c.json({ error: 'Missing nextId in request body' }, 400);
      }

      const result = linkTraces(prevId, nextId);

      if (!result.success) {
        return c.json({ error: result.message }, 400);
      }

      return c.json(result);
    } catch (err) {
      console.error('Link traces error:', err);
      return c.json({ error: 'Failed to link traces' }, 500);
    }
  });

  // Unlink trace: DELETE /api/traces/:id/link?direction=prev|next
  app.delete('/api/traces/:id/link', async (c) => {
    try {
      const traceId = c.req.param('id');
      const direction = c.req.query('direction') as 'prev' | 'next';

      if (!direction || !['prev', 'next'].includes(direction)) {
        return c.json({ error: 'Missing or invalid direction (prev|next)' }, 400);
      }

      const result = unlinkTraces(traceId, direction);

      if (!result.success) {
        return c.json({ error: result.message }, 400);
      }

      return c.json(result);
    } catch (err) {
      console.error('Unlink traces error:', err);
      return c.json({ error: 'Failed to unlink traces' }, 500);
    }
  });

  // Get trace linked chain: GET /api/traces/:id/linked-chain
  app.get('/api/traces/:id/linked-chain', async (c) => {
    try {
      const traceId = c.req.param('id');
      const result = getTraceLinkedChain(traceId);
      return c.json(result);
    } catch (err) {
      console.error('Get linked chain error:', err);
      return c.json({ error: 'Failed to get linked chain' }, 500);
    }
  });
}
