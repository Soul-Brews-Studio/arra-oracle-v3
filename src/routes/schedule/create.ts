import { Elysia } from 'elysia';
import { db, schedule } from '../../db/index.ts';
import { tenantIdForWrite } from '../../middleware/tenant.ts';
import { parseDate } from '../../tools/schedule.ts';
import { createBody } from './model.ts';

export const scheduleCreateRoute = new Elysia().post('/api/schedule', async ({ body }) => {
  const data = body as any;
  const date = parseDate(data.date);
  const now = Date.now();
  const row = db.insert(schedule).values({
    tenantId: tenantIdForWrite(),
    date,
    dateRaw: data.date,
    time: data.time || null,
    event: data.event,
    notes: data.notes || null,
    recurring: data.recurring || null,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  }).returning({ id: schedule.id }).get();
  return {
    success: true,
    id: row.id,
    date,
    dateRaw: data.date,
    event: data.event,
    time: data.time || 'TBD',
    notes: data.notes || '',
    message: 'Event added to schedule',
  };
}, {
  body: createBody,
  detail: {
    tags: ['schedule'],
    menu: { group: 'hidden' },
    summary: 'Create a schedule entry',
  },
});
