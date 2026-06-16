import { randomUUID } from 'node:crypto';
import { Elysia } from 'elysia';
import { desc } from 'drizzle-orm';
import { db, exportJobs } from '../../db/index.ts';
import { exportHistoryRunBody, type ExportHistoryJob } from './model.ts';

function clean(value: string): string {
  return value.trim();
}

export function createExportHistoryRoutes() {
  return new Elysia()
    .post('/export/run', ({ body, set }) => {
      const collection = clean(body.collection);
      const format = clean(body.format);
      const status = clean(body.status ?? 'completed');
      if (!collection || !format || !status) {
        set.status = 400;
        return { error: 'collection, format, and status must be non-empty' };
      }

      const job: ExportHistoryJob = {
        id: randomUUID(),
        collection,
        format,
        timestamp: Date.now(),
        status,
      };
      db.insert(exportJobs).values(job).run();
      set.status = 201;
      return { job };
    }, {
      body: exportHistoryRunBody,
      detail: {
        tags: ['export'],
        menu: { group: 'hidden' },
        summary: 'Record an export job history entry',
      },
    })
    .get('/export/history', () => {
      const jobs = db.select({
        id: exportJobs.id,
        collection: exportJobs.collection,
        format: exportJobs.format,
        timestamp: exportJobs.timestamp,
        status: exportJobs.status,
      }).from(exportJobs).orderBy(desc(exportJobs.timestamp)).limit(50).all();
      return { jobs, total: jobs.length, limit: 50 };
    }, {
      detail: {
        tags: ['export'],
        menu: { group: 'hidden' },
        summary: 'List latest export job history entries',
      },
    });
}

export const exportHistoryRoutes = new Elysia({ prefix: '/api' }).use(createExportHistoryRoutes());
