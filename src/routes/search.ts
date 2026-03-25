/**
 * Search Routes — /api/search, /api/reflect, /api/similar, /api/map, /api/map3d, /api/list
 */

import type { Hono } from 'hono';
import {
  handleSearch,
  handleReflect,
  handleList,
  handleSimilar,
  handleMap,
  handleMap3d,
} from '../server/handlers.ts';

export function registerSearchRoutes(app: Hono) {
  // Search
  app.get('/api/search', async (c) => {
    const q = c.req.query('q');
    if (!q) {
      return c.json({ error: 'Missing query parameter: q' }, 400);
    }

    // SECURITY: Sanitize search input — strip HTML tags and control characters
    const sanitizedQ = q
      .replace(/<[^>]*>/g, '')    // Strip HTML tags (XSS prevention)
      .replace(/[\x00-\x1f]/g, '') // Strip control characters
      .trim();
    if (!sanitizedQ) {
      return c.json({ error: 'Invalid query: empty after sanitization' }, 400);
    }

    const type = c.req.query('type') || 'all';
    const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '10')));
    const offset = Math.max(0, parseInt(c.req.query('offset') || '0'));
    const mode = (c.req.query('mode') || 'hybrid') as 'hybrid' | 'fts' | 'vector';
    const project = c.req.query('project'); // Explicit project filter
    const cwd = c.req.query('cwd');         // Auto-detect project from cwd
    const model = c.req.query('model');     // Embedding model: 'bge-m3' (default), 'nomic', or 'qwen3'

    try {
      const result = await handleSearch(sanitizedQ, type, limit, offset, mode, project, cwd, model);
      return c.json({ ...result, query: sanitizedQ });
    } catch (e: any) {
      // Catch FTS5 parse errors gracefully instead of 500
      return c.json({ results: [], total: 0, query: sanitizedQ, error: 'Search failed' }, 400);
    }
  });

  // Reflect
  app.get('/api/reflect', (c) => {
    return c.json(handleReflect());
  });

  // Similar documents (vector nearest neighbors)
  app.get('/api/similar', async (c) => {
    const id = c.req.query('id');
    if (!id) {
      return c.json({ error: 'Missing query parameter: id' }, 400);
    }
    const limit = Math.min(50, Math.max(1, parseInt(c.req.query('limit') || '5')));
    const model = c.req.query('model');
    try {
      const result = await handleSimilar(id, limit, model);
      return c.json(result);
    } catch (e: any) {
      // Return empty results instead of 500 when no embedding found
      return c.json({ error: e.message, results: [], docId: id }, 404);
    }
  });

  // Knowledge map (2D projection of all embeddings)
  app.get('/api/map', async (c) => {
    try {
      const result = await handleMap();
      return c.json(result);
    } catch (e: any) {
      return c.json({ error: e.message, documents: [], total: 0 }, 500);
    }
  });

  // Knowledge map 3D (real PCA from LanceDB bge-m3 embeddings)
  app.get('/api/map3d', async (c) => {
    try {
      const model = c.req.query('model') || undefined;
      const result = await handleMap3d(model);
      return c.json(result);
    } catch (e: any) {
      return c.json({ error: e.message, documents: [], total: 0 }, 500);
    }
  });

  // List documents
  app.get('/api/list', (c) => {
    const type = c.req.query('type') || 'all';
    const limit = Math.min(1000, Math.max(1, parseInt(c.req.query('limit') || '10')));
    const offset = Math.max(0, parseInt(c.req.query('offset') || '0'));
    const group = c.req.query('group') !== 'false';

    return c.json(handleList(type, limit, offset, group));
  });
}
