import { Elysia } from 'elysia';
import { exportAppRoutes } from './app.ts';
import { exportBatchRoutes } from './batch.ts';
import { exportCoreRoutes } from './core.ts';
import { exportImportRoutes } from './import.ts';

export { createExportCoreRoutes, exportCoreRoutes } from './core.ts';
export { createExportAppRoutes, exportAppRoutes } from './app.ts';
export { createExportBatchRoutes, exportBatchRoutes } from './batch.ts';
export { createExportImportRoutes, exportImportRoutes } from './import.ts';

export const exportRoutes = new Elysia()
  .use(exportCoreRoutes)
  .use(exportAppRoutes)
  .use(exportBatchRoutes)
  .use(exportImportRoutes);
