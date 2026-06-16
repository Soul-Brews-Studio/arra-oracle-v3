/** Export Data App routes — async data export jobs and artifact downloads. */

import { Elysia } from 'elysia';
import { exportCreateBody, normalizeExportRequest } from './model.ts';
import { defaultExportJobManager, type ExportJobManager } from './jobs.ts';

export function createExportRoutes(manager: ExportJobManager = defaultExportJobManager) {
  return new Elysia({ prefix: '/api' })
    .post('/export', ({ body, set }) => {
      set.status = 202;
      return { job: manager.create(normalizeExportRequest(body)) };
    }, {
      body: exportCreateBody,
      detail: {
        tags: ['export'],
        menu: { group: 'tools', order: 58 },
        summary: 'Start an asynchronous Oracle data export job',
      },
    })
    .get('/export/:id', ({ params, set }) => {
      const job = manager.get(params.id);
      if (!job) {
        set.status = 404;
        return { error: 'Export job not found', id: params.id };
      }
      return { job };
    }, {
      detail: {
        tags: ['export'],
        summary: 'Read export job status',
      },
    })
    .get('/export/:id/download', async ({ params, set }) => {
      const result = await manager.download(params.id);
      if (result.ok) return result.response;
      set.status = result.status;
      return result.body;
    }, {
      detail: {
        tags: ['export'],
        summary: 'Download a completed export artifact',
      },
    });
}

export const exportRoutes = createExportRoutes();
