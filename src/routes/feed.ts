/**
 * Feed Routes — /api/feed (GET + POST), MAW_JS_URL integration
 */

import type { Hono } from 'hono';
import fs from 'fs';
import { FEED_LOG } from '../config.ts';

const MAW_JS_URL = process.env.MAW_JS_URL || 'http://localhost:3456';

export function registerFeedRoutes(app: Hono) {
  app.get('/api/feed', async (c) => {
    try {
      const limit = Math.min(200, parseInt(c.req.query('limit') || '50'));
      const oracle = c.req.query('oracle') || undefined;
      const event = c.req.query('event') || undefined;
      const since = c.req.query('since') || undefined;

      // Collect events from both sources
      let allEvents: any[] = [];

      // 1. Local feed.log
      if (fs.existsSync(FEED_LOG)) {
        const raw = fs.readFileSync(FEED_LOG, 'utf-8').trim().split('\n').filter(Boolean);
        const localEvents = raw.map(line => {
          const [ts, oracleName, host, eventType, project, rest] = line.split(' | ').map(s => s.trim());
          const [sessionId, ...msgParts] = (rest || '').split(' » ');
          return {
            timestamp: ts,
            oracle: oracleName,
            host,
            event: eventType,
            project,
            session_id: sessionId?.trim(),
            message: msgParts.join(' » ').trim(),
            source: 'local'
          };
        });
        allEvents.push(...localEvents);
      }

      // 2. Fetch from maw-js
      try {
        const mawRes = await fetch(`${MAW_JS_URL}/api/feed?limit=100`, { signal: AbortSignal.timeout(2000) });
        if (mawRes.ok) {
          const mawData = await mawRes.json() as any;
          if (mawData.events && Array.isArray(mawData.events)) {
            const mawEvents = mawData.events.map((e: any) => ({
              timestamp: e.timestamp || new Date(e.ts).toISOString().replace('T', ' ').slice(0, 19),
              oracle: e.oracle,
              host: e.host,
              event: e.event,
              project: e.project,
              session_id: e.sessionId,
              message: e.message,
              source: 'maw-js'
            }));
            allEvents.push(...mawEvents);
          }
        }
      } catch (mawError) {
        // maw-js not available, continue with local only
        console.log('maw-js feed unavailable:', mawError);
      }

      // Filter
      if (oracle) allEvents = allEvents.filter(e => e.oracle === oracle);
      if (event) allEvents = allEvents.filter(e => e.event === event);
      if (since) allEvents = allEvents.filter(e => e.timestamp >= since);

      // Sort by timestamp (newest first) and limit
      allEvents.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      const total = allEvents.length;
      allEvents = allEvents.slice(0, limit);

      // Active oracles (from last 5 min)
      const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString().replace('T', ' ').slice(0, 19);
      const activeOracles = [...new Set(allEvents.filter(e => e.timestamp >= fiveMinAgo).map(e => e.oracle))];

      return c.json({ events: allEvents, total, active_oracles: activeOracles });
    } catch (e: any) {
      return c.json({ error: e.message, events: [], total: 0 }, 500);
    }
  });

  // Log an event to feed.log
  app.post('/api/feed', async (c) => {
    try {
      const body = await c.req.json();
      const { oracle, event, project, session_id, message } = body;

      if (!oracle || !event) {
        return c.json({ error: 'Missing required fields: oracle, event' }, 400);
      }

      const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
      const host = require('os').hostname();
      const line = `${timestamp} | ${oracle} | ${host} | ${event} | ${project || ''} | ${session_id || ''} » ${message || ''}\n`;

      fs.appendFileSync(FEED_LOG, line);
      return c.json({ success: true, timestamp });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });
}
