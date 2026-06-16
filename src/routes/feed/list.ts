import { Elysia } from 'elysia';
import fs from 'fs';
import { FEED_LOG } from '../../config.ts';
import { currentTenantId, tenantDataPath, TENANT_HEADER } from '../../middleware/tenant.ts';
import { FeedQuery, type FeedEvent } from './model.ts';

const MAW_JS_URL = process.env.MAW_JS_URL || 'http://localhost:3456';

function parseLocalEvent(line: string, fallbackTenantId?: string): FeedEvent {
  const parts = line.split(' | ').map(s => s.trim());
  const hasTenant = parts.length >= 7;
  const [ts, tenantOrOracle, oracleOrHost, hostOrEvent, eventOrProject, projectOrRest, restValue] = parts;
  const rest = hasTenant ? restValue : projectOrRest;
  const [sessionId, ...msgParts] = (rest || '').split(' » ');
  return {
    timestamp: ts,
    tenant_id: hasTenant ? tenantOrOracle : fallbackTenantId,
    oracle: hasTenant ? oracleOrHost : tenantOrOracle,
    host: hasTenant ? hostOrEvent : oracleOrHost,
    event: hasTenant ? eventOrProject : hostOrEvent,
    project: hasTenant ? projectOrRest : eventOrProject,
    session_id: sessionId?.trim(),
    message: msgParts.join(' » ').trim(),
    source: 'local',
  };
}

function tenantForEvent(event: unknown): string | undefined {
  if (!event || typeof event !== 'object') return undefined;
  const value = (event as Record<string, unknown>).tenant_id
    ?? (event as Record<string, unknown>).tenantId
    ?? (event as Record<string, unknown>).tenant;
  return typeof value === 'string' ? value : undefined;
}

export const listFeedRoute = new Elysia().get('/', async ({ query, set }) => {
  try {
    const limit = Math.min(200, parseInt(query.limit || '50'));
    const oracle = query.oracle || undefined;
    const event = query.event || undefined;
    const since = query.since || undefined;

    const tenantId = currentTenantId();
    const feedLog = tenantDataPath(FEED_LOG);
    let allEvents: FeedEvent[] = [];

    if (fs.existsSync(feedLog)) {
      const raw = fs.readFileSync(feedLog, 'utf-8').trim().split('\n').filter(Boolean);
      allEvents.push(...raw.map(line => parseLocalEvent(line, tenantId)));
    }

    try {
      const mawRes = await fetch(`${MAW_JS_URL}/api/feed?limit=100`, {
        headers: tenantId ? { [TENANT_HEADER]: tenantId } : undefined,
        signal: AbortSignal.timeout(2000),
      });
      if (mawRes.ok) {
        const mawData = await mawRes.json() as any;
        if (mawData.events && Array.isArray(mawData.events)) {
          const mawEvents: FeedEvent[] = mawData.events
            .filter((e: any) => !tenantId || tenantForEvent(e) === tenantId)
            .map((e: any) => ({
              timestamp: e.timestamp || new Date(e.ts).toISOString().replace('T', ' ').slice(0, 19),
              tenant_id: tenantForEvent(e),
              oracle: e.oracle,
              host: e.host,
              event: e.event,
              project: e.project,
              session_id: e.sessionId,
              message: e.message,
              source: 'maw-js',
            }));
          allEvents.push(...mawEvents);
        }
      }
    } catch (mawError) {
      console.log('maw-js feed unavailable:', mawError);
    }

    if (oracle) allEvents = allEvents.filter(e => e.oracle === oracle);
    if (event) allEvents = allEvents.filter(e => e.event === event);
    if (since) allEvents = allEvents.filter(e => e.timestamp >= since);

    allEvents.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    const total = allEvents.length;
    allEvents = allEvents.slice(0, limit);

    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString().replace('T', ' ').slice(0, 19);
    const activeOracles = [...new Set(allEvents.filter(e => e.timestamp >= fiveMinAgo).map(e => e.oracle))];

    return { events: allEvents, total, active_oracles: activeOracles };
  } catch (e: any) {
    set.status = 500;
    return { error: e.message, events: [], total: 0 };
  }
}, {
  query: FeedQuery,
  detail: {
    tags: ['feed'],
    menu: { group: 'hidden' },
    summary: 'Merged local + maw-js feed events',
  },
});
