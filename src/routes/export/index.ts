/** Export Data App routes — core dumps, app helpers, and async artifacts. */

import { Elysia } from 'elysia';
import { exportCreateBody, normalizeExportRequest } from './model.ts';
import { defaultExportJobManager, type ExportJobManager } from './jobs.ts';
import { createExportHistoryRoutes } from './history.ts';
import { exportCoreRoutes } from './core.ts';
import { exportAppRoutes } from './app.ts';
import { exportBatchRoutes } from './batch.ts';
import { exportImportRoutes } from './import.ts';

export { createExportCoreRoutes, exportCoreRoutes } from './core.ts';
export { createExportAppRoutes, exportAppRoutes } from './app.ts';
export { createExportBatchRoutes, exportBatchRoutes } from './batch.ts';
export { createExportImportRoutes, exportImportRoutes } from './import.ts';
export { createExportTestConnectionRoutes, exportTestConnectionRoutes } from './test-connection.ts';

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
    .use(createExportHistoryRoutes())
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

export function createCombinedExportRoutes(manager: ExportJobManager = defaultExportJobManager) {
  return new Elysia()
    .use(exportCoreRoutes)
    .use(exportAppRoutes)
    .use(exportBatchRoutes)
    .use(exportImportRoutes)
    .use(createExportRoutes(manager));
}

export const exportRoutes = createCombinedExportRoutes();
