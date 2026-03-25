/**
 * Supersede Routes — /api/supersede, /api/supersede/chain (Issue #18, #19)
 */

import type { Hono } from 'hono';
import { eq, desc, sql } from 'drizzle-orm';
import { db, supersedeLog } from '../db/index.ts';

export function registerSupersedeRoutes(app: Hono) {
  // List supersessions with optional filters
  app.get('/api/supersede', (c) => {
    const project = c.req.query('project');
    const limit = parseInt(c.req.query('limit') || '50');
    const offset = parseInt(c.req.query('offset') || '0');

    const whereClause = project ? eq(supersedeLog.project, project) : undefined;

    const countResult = db.select({ total: sql<number>`count(*)` })
      .from(supersedeLog)
      .where(whereClause)
      .get();
    const total = countResult?.total || 0;

    const logs = db.select()
      .from(supersedeLog)
      .where(whereClause)
      .orderBy(desc(supersedeLog.supersededAt))
      .limit(limit)
      .offset(offset)
      .all();

    return c.json({
      supersessions: logs.map(log => ({
        id: log.id,
        old_path: log.oldPath,
        old_id: log.oldId,
        old_title: log.oldTitle,
        old_type: log.oldType,
        new_path: log.newPath,
        new_id: log.newId,
        new_title: log.newTitle,
        reason: log.reason,
        superseded_at: new Date(log.supersededAt).toISOString(),
        superseded_by: log.supersededBy,
        project: log.project
      })),
      total,
      limit,
      offset
    });
  });

  // Get supersede chain for a document
  app.get('/api/supersede/chain/:path', (c) => {
    const docPath = decodeURIComponent(c.req.param('path'));

    const asOld = db.select()
      .from(supersedeLog)
      .where(eq(supersedeLog.oldPath, docPath))
      .orderBy(supersedeLog.supersededAt)
      .all();

    const asNew = db.select()
      .from(supersedeLog)
      .where(eq(supersedeLog.newPath, docPath))
      .orderBy(supersedeLog.supersededAt)
      .all();

    return c.json({
      superseded_by: asOld.map(log => ({
        new_path: log.newPath,
        reason: log.reason,
        superseded_at: new Date(log.supersededAt).toISOString()
      })),
      supersedes: asNew.map(log => ({
        old_path: log.oldPath,
        reason: log.reason,
        superseded_at: new Date(log.supersededAt).toISOString()
      }))
    });
  });

  // Log a new supersession
  app.post('/api/supersede', async (c) => {
    try {
      const data = await c.req.json();
      if (!data.old_path) {
        return c.json({ error: 'Missing required field: old_path' }, 400);
      }

      const result = db.insert(supersedeLog).values({
        oldPath: data.old_path,
        oldId: data.old_id || null,
        oldTitle: data.old_title || null,
        oldType: data.old_type || null,
        newPath: data.new_path || null,
        newId: data.new_id || null,
        newTitle: data.new_title || null,
        reason: data.reason || null,
        supersededAt: Date.now(),
        supersededBy: data.superseded_by || 'user',
        project: data.project || null
      }).returning({ id: supersedeLog.id }).get();

      return c.json({
        id: result.id,
        message: 'Supersession logged'
      }, 201);
    } catch (error) {
      return c.json({
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 500);
    }
  });
}
