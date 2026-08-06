import { Elysia } from 'elysia';
import { asc, eq } from 'drizzle-orm';
import fs from 'fs';
import { SCHEDULE_PATH } from '../../config.ts';
import { db, schedule } from '../../db/index.ts';
import { currentTenantId } from '../../middleware/tenant.ts';

function tenantMarkdown(tenantId: string): string {
  const events = db.select().from(schedule)
    .where(eq(schedule.tenantId, tenantId))
    .orderBy(asc(schedule.date), asc(schedule.time))
    .all();
  const rows = events.map((ev) => `| ${ev.dateRaw || ev.date} | ${ev.time || 'TBD'} | ${ev.event} | ${ev.notes || ''} |`);
  return [
    '# Schedule',
    '',
    `**Tenant**: ${tenantId}`,
    '',
    '| Date | Time | Event | Notes |',
    '|------|------|-------|-------|',
    ...rows,
    '',
  ].join('\n');
}

export const scheduleMdRoute = new Elysia().get('/api/schedule/md', ({ set }) => {
  const tenantId = currentTenantId();
  if (tenantId) return tenantMarkdown(tenantId);
  if (fs.existsSync(SCHEDULE_PATH)) {
    return fs.readFileSync(SCHEDULE_PATH, 'utf-8');
  }
  set.status = 404;
  return '';
}, {
  detail: {
    tags: ['schedule'],
    menu: { group: 'hidden' },
    summary: 'Raw schedule markdown',
  },
});
