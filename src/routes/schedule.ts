/**
 * Schedule Routes — /api/schedule/*, /api/schedule/md
 */

import type { Hono } from 'hono';
import fs from 'fs';
import { eq } from 'drizzle-orm';
import { REPO_ROOT, SCHEDULE_PATH } from '../config.ts';
import { db, sqlite, schedule } from '../db/index.ts';
import { handleScheduleAdd, handleScheduleList } from '../tools/schedule.ts';
import type { ToolContext } from '../tools/types.ts';

export function registerScheduleRoutes(app: Hono) {
  // Serve raw schedule.md for frontend rendering
  app.get('/api/schedule/md', (c) => {
    const schedulePath = SCHEDULE_PATH;
    if (fs.existsSync(schedulePath)) {
      return c.text(fs.readFileSync(schedulePath, 'utf-8'));
    }
    return c.text('', 404);
  });

  app.get('/api/schedule', async (c) => {
    const ctx = { db, sqlite, repoRoot: REPO_ROOT } as Pick<ToolContext, 'db' | 'sqlite' | 'repoRoot'>;
    const result = await handleScheduleList(ctx as ToolContext, {
      date: c.req.query('date'),
      from: c.req.query('from'),
      to: c.req.query('to'),
      filter: c.req.query('filter'),
      status: c.req.query('status') as 'pending' | 'done' | 'cancelled' | 'all' | undefined,
      limit: c.req.query('limit') ? parseInt(c.req.query('limit')!) : undefined,
    });
    const text = result.content[0]?.text || '{}';
    return c.json(JSON.parse(text));
  });

  app.post('/api/schedule', async (c) => {
    const body = await c.req.json();
    const ctx = { db, sqlite, repoRoot: REPO_ROOT } as Pick<ToolContext, 'db' | 'sqlite' | 'repoRoot'>;
    const result = await handleScheduleAdd(ctx as ToolContext, body);
    const text = result.content[0]?.text || '{}';
    return c.json(JSON.parse(text));
  });

  // Update schedule event status
  app.patch('/api/schedule/:id', async (c) => {
    const id = parseInt(c.req.param('id'));
    const body = await c.req.json();
    const now = Date.now();
    db.update(schedule)
      .set({ ...body, updatedAt: now })
      .where(eq(schedule.id, id))
      .run();
    return c.json({ success: true, id });
  });
}
