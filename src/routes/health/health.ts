import { Elysia } from 'elysia';
import { PORT } from '../../config.ts';
import { MCP_SERVER_NAME } from '../../const.ts';
import { getVectorRuntimeStatus } from '../../vector/runtime-status.ts';
import pkg from '../../../package.json' with { type: 'json' };

export const healthEndpoint = new Elysia().get('/health', () => ({
  status: 'ok',
  server: MCP_SERVER_NAME,
  version: pkg.version,
  port: PORT,
  oracle: 'connected',
  ...getVectorRuntimeStatus(),
}), {
  detail: {
    tags: ['health'],
    menu: { group: 'hidden' },
    summary: 'Server liveness check',
  },
});
