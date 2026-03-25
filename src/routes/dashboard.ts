/**
 * Dashboard Routes — /api/dashboard/*, /api/session/stats
 */

import type { Hono } from 'hono';
import { gt, sql } from 'drizzle-orm';
import { db, searchLog, learnLog } from '../db/index.ts';
import {
  handleDashboardSummary,
  handleDashboardActivity,
  handleDashboardGrowth
} from '../server/dashboard.ts';

export function registerDashboardRoutes(app: Hono) {
  app.get('/api/dashboard', (c) => c.json(handleDashboardSummary()));
  app.get('/api/dashboard/summary', (c) => c.json(handleDashboardSummary()));

  app.get('/api/dashboard/activity', (c) => {
    const days = parseInt(c.req.query('days') || '7');
    return c.json(handleDashboardActivity(days));
  });

  app.get('/api/dashboard/growth', (c) => {
    const period = c.req.query('period') || 'week';
    return c.json(handleDashboardGrowth(period));
  });

  // Session stats endpoint - tracks activity from DB (includes MCP usage)
  app.get('/api/session/stats', (c) => {
    const since = c.req.query('since');
    const sinceTime = since ? parseInt(since) : Date.now() - 24 * 60 * 60 * 1000; // Default 24h

    const searches = db.select({ count: sql<number>`count(*)` })
      .from(searchLog)
      .where(gt(searchLog.createdAt, sinceTime))
      .get();

    const learnings = db.select({ count: sql<number>`count(*)` })
      .from(learnLog)
      .where(gt(learnLog.createdAt, sinceTime))
      .get();

    return c.json({
      searches: searches?.count || 0,
      learnings: learnings?.count || 0,
      since: sinceTime
    });
  });
}
