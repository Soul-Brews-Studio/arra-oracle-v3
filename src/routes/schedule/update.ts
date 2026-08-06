import { Elysia } from 'elysia';
import { and, eq } from 'drizzle-orm';
import { db, schedule } from '../../db/index.ts';
import { currentTenantId } from '../../middleware/tenant.ts';
import { parseDate } from '../../tools/schedule.ts';
import { scheduleIdParam, updateBody } from './model.ts';

function readScheduleId(value: string): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function updateValues(body: unknown, updatedAt: number): Record<string, unknown> {
  const data = body as Record<string, unknown>;
  const values: Record<string, unknown> = { ...data, updatedAt };
  if (typeof data.date === 'string') {
    values.date = parseDate(data.date);
    values.dateRaw = data.date;
  }
  return values;
}

export const scheduleUpdateRoute = new Elysia().patch('/api/schedule/:id', async ({ params, body, set }) => {
  const id = readScheduleId(params.id);
  if (!id) {
    set.status = 400;
    return { success: false, error: 'Invalid schedule id' };
  }
  const now = Date.now();
  const tenantId = currentTenantId();
  const where = tenantId ? and(eq(schedule.id, id), eq(schedule.tenantId, tenantId)) : eq(schedule.id, id);
  const row = db.update(schedule)
    .set(updateValues(body, now))
    .where(where)
    .returning({ id: schedule.id })
    .get();
  if (!row) {
    set.status = 404;
    return { success: false, error: 'Schedule entry not found' };
  }
  return { success: true, id };
}, {
  params: scheduleIdParam,
  body: updateBody,
  detail: {
    tags: ['schedule'],
    menu: { group: 'hidden' },
    summary: 'Update a schedule entry',
  },
});
