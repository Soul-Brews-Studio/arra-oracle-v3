import { Elysia } from 'elysia';
import fs from 'fs';
import { FEED_LOG } from '../../config.ts';
import { currentTenantId, tenantDataPath, TENANT_HEADER } from '../../middleware/tenant.ts';
import { FeedQuery, type FeedEvent } from './model.ts';

const MAW_JS_URL = process.env.MAW_JS_URL || 'http://localhost:3456';
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export function normalizeFeedLimit(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function valueString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function parseLocalEvent(line: string, fallbackTenantId?: string): FeedEvent | undefined {
  const parts = line.split(' | ').map(s => s.trim());
  if (parts.length < 6) return undefined;
  const hasTenant = parts.length >= 7;
  const [ts, tenantOrOracle, oracleOrHost, hostOrEvent, eventOrProject, projectOrRest, ...restParts] = parts;
  const rest = (hasTenant ? restParts : [projectOrRest, ...restParts]).join(' | ');
  const [sessionId, ...msgParts] = (rest || '').split(' » ');
  const oracle = hasTenant ? oracleOrHost : tenantOrOracle;
  const event = hasTenant ? eventOrProject : hostOrEvent;
  if (!ts || !oracle || !event) return undefined;
  return {
    timestamp: ts,
    tenant_id: hasTenant ? tenantOrOracle : fallbackTenantId,
    oracle,
    host: hasTenant ? hostOrEvent : oracleOrHost,
    event,
    project: hasTenant ? projectOrRest : eventOrProject,
    session_id: sessionId?.trim() ?? '',
    message: msgParts.join(' » ').trim(),
    source: 'local',
  };
}

function remoteTimestamp(event: Record<string, unknown>): string {
  const timestamp = valueString(event.timestamp).trim();
  if (timestamp) return timestamp;
  const date = new Date(valueString(event.ts));
  return Number.isNaN(date.getTime())
    ? new Date().toISOString().replace('T', ' ').slice(0, 19)
    : date.toISOString().replace('T', ' ').slice(0, 19);
}

function parseMawEvent(event: unknown): FeedEvent | undefined {
  if (!event || typeof event !== 'object') return undefined;
  const raw = event as Record<string, unknown>;
  const oracle = valueString(raw.oracle);
  const type = valueString(raw.event);
  if (!oracle || !type) return undefined;
  return {
    timestamp: remoteTimestamp(raw),
    tenant_id: tenantForEvent(raw),
    oracle,
    host: valueString(raw.host),
    event: type,
    project: valueString(raw.project),
    session_id: valueString(raw.sessionId ?? raw.session_id),
    message: valueString(raw.message),
    source: 'maw-js',
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
      const mawRes = await fetch(`${MAW_JS_URL}/api/feed?limit=100`, {
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
