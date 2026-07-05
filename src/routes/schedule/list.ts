import { Elysia } from 'elysia';
import { and, asc, eq, gte, like, lte, or, type SQL } from 'drizzle-orm';
import { db, schedule } from '../../db/index.ts';
import { currentTenantId } from '../../middleware/tenant.ts';
import { parseDate } from '../../tools/schedule.ts';
import { listQuery } from './model.ts';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function readLimit(value?: string): number | string {
  if (value === undefined) return DEFAULT_LIMIT;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) return `limit must be an integer between 1 and ${MAX_LIMIT}`;
  return Math.min(limit, MAX_LIMIT);
}

export const scheduleListRoute = new Elysia().get('/api/schedule', async ({ query, set }) => {
  const limit = readLimit(query.limit);
  if (typeof limit === 'string') {
    set.status = 400;
    return { total: 0, events: [], byDate: {}, error: limit };
  }
  const conditions: SQL[] = [];
  const tenantId = currentTenantId();
  if (tenantId) conditions.push(eq(schedule.tenantId, tenantId));
  if ((query.status || 'pending') !== 'all') conditions.push(eq(schedule.status, query.status || 'pending'));
  if (query.date) {
    conditions.push(eq(schedule.date, parseDate(query.date)));
  } else {
    const from = query.from ? parseDate(query.from) : new Date().toISOString().slice(0, 10);
    const to = query.to ? parseDate(query.to) : (() => {
      const d = new Date();
      d.setDate(d.getDate() + 14);
      return d.toISOString().slice(0, 10);
    })();
    conditions.push(gte(schedule.date, from), lte(schedule.date, to));
  }
  if (query.filter) {
    conditions.push(or(like(schedule.event, `%${query.filter}%`), like(schedule.notes, `%${query.filter}%`))!);
  }
  const events = db.select().from(schedule)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(schedule.date), asc(schedule.time))
    .limit(limit)
    .all();
  const byDate: Record<string, typeof events> = {};
  for (const event of events) (byDate[event.date] ??= []).push(event);
  return {
    total: events.length,
    events: events.map((event) => ({
      id: event.id,
      date: event.date,
      dateRaw: event.dateRaw,
      time: event.time || 'TBD',
      event: event.event,
      notes: event.notes,
      recurring: event.recurring,
      status: event.status,
    })),
    byDate,
  };
}, {
  query: listQuery,
  detail: {
    tags: ['schedule'],
    menu: { group: 'main', path: '/schedule', order: 60 },
    summary: 'List scheduled events',
  },
});
