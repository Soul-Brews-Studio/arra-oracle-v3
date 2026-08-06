import { Elysia } from 'elysia';
import fs from 'fs';
import { FEED_LOG } from '../../config.ts';
import { currentTenantId, tenantDataPath, TENANT_HEADER } from '../../middleware/tenant.ts';
import { feedTimestampMs, normalizeFeedLimit, parseLocalEvent, parseMawEvent, type FeedEvent } from '../../feed/events.ts';
import { FeedQuery } from './model.ts';

function mawJsUrl(): string {
  return (process.env.MAW_JS_URL || 'http://localhost:3456').replace(/\/$/, '');
}

export const listFeedRoute = new Elysia().get('/', async ({ query, set }) => {
  try {
    const limit = normalizeFeedLimit(query.limit);
    const oracle = query.oracle || undefined;
    const event = query.event || undefined;
    const since = query.since || undefined;

    const tenantId = currentTenantId();
    const feedLog = tenantDataPath(FEED_LOG);
    let allEvents: FeedEvent[] = [];

    if (fs.existsSync(feedLog)) {
      const raw = fs.readFileSync(feedLog, 'utf-8').trim().split('\n').filter(Boolean);
      allEvents.push(...raw.map(line => parseLocalEvent(line, tenantId)).filter((event): event is FeedEvent => Boolean(event)));
    }

    try {
      const mawRes = await fetch(`${mawJsUrl()}/api/feed?limit=100`, {
        headers: tenantId ? { [TENANT_HEADER]: tenantId } : undefined,
        signal: AbortSignal.timeout(2000),
      });
      if (mawRes.ok) {
        const mawData = await mawRes.json() as any;
        if (mawData.events && Array.isArray(mawData.events)) {
          const rawEvents = mawData.events as unknown[];
          const mawEvents: FeedEvent[] = rawEvents
            .map(parseMawEvent)
            .filter((event): event is FeedEvent => Boolean(event))
            .filter((event) => !tenantId || event.tenant_id === tenantId);
          allEvents.push(...mawEvents);
        }
      }
    } catch (mawError) {
      console.log('maw-js feed unavailable:', mawError);
    }

    if (oracle) allEvents = allEvents.filter(e => e.oracle === oracle);
    if (event) allEvents = allEvents.filter(e => e.event === event);
    if (since) allEvents = allEvents.filter(e => e.timestamp >= since);

    allEvents.sort((a, b) => feedTimestampMs(b) - feedTimestampMs(a));
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
