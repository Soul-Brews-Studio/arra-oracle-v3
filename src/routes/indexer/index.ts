import { Elysia } from 'elysia';
import { configEndpoint } from './config.ts';
import { scanEndpoint } from './scan.ts';
import { startEndpoint } from './start.ts';
import { reindexEndpoint } from './reindex.ts';
import { progressEndpoint } from './progress.ts';
import { stopEndpoint } from './stop.ts';

export const indexerRoutes = new Elysia({ prefix: '/api' })
  .use(configEndpoint)
  .use(scanEndpoint)
  .use(startEndpoint)
  .use(reindexEndpoint)
  .use(progressEndpoint)
  .use(stopEndpoint);
