import { Elysia } from 'elysia';
import { and, eq } from 'drizzle-orm';
import { db, schedule } from '../../db/index.ts';
import { currentTenantId } from '../../middleware/tenant.ts';
import { scheduleIdParam, updateBody } from './model.ts';

export const scheduleUpdateRoute = new Elysia().patch('/api/schedule/:id', async ({ params, body, set }) => {
  const id = parseInt(params.id);
  const now = Date.now();
  const tenantId = currentTenantId();
  const where = tenantId ? and(eq(schedule.id, id), eq(schedule.tenantId, tenantId)) : eq(schedule.id, id);
  const row = db.update(schedule)
    .set({ ...(body as any), updatedAt: now })
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
