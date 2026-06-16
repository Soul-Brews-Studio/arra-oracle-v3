/**
 * Vector service registry API.
 *
 * Endpoints (mounted under /api via vectorRoutes):
 *   - GET    /vector/services
 *   - POST   /vector/services/register
 *   - DELETE /vector/services/:name
 *   - POST   /vector/services/:name/test
 */

import { Elysia, t } from 'elysia';
import {
  vectorServiceRegistry,
  type HealthStatus,
} from '../../vector/registry.ts';

const capabilitySchema = t.Record(t.String(), t.Unknown());

export const vectorServicesApiEndpoint = new Elysia()
  .get('/vector/services', async () => {
    const services = await vectorServiceRegistry.discover();
    const health = await vectorServiceRegistry.healthCheck();
    const list = services.map((service) => ({
      ...service,
      health: health.get(service.name) ?? ({ status: 'unknown', checkedAt: new Date().toISOString() } as HealthStatus),
    }));
    return { services: list, count: list.length };
  }, {
    detail: { tags: ['vector-registry'], summary: 'List registered vector services' },
  })
  .post('/vector/services/register', async ({ body, set }) => {
    try {
      const service = await vectorServiceRegistry.register(body);
      return { success: true, service };
    } catch (error) {
      set.status = 400;
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }, {
    body: t.Object({
      name: t.String({ minLength: 1 }),
      type: t.Union([t.Literal('builtin'), t.Literal('proxy')]),
      endpoint: t.Optional(t.String()),
      capabilities: t.Optional(capabilitySchema),
    }),
    detail: { tags: ['vector-registry'], summary: 'Register a vector service' },
  })
  .delete('/vector/services/:name', async ({ params, set }) => {
    const removed = await vectorServiceRegistry.unregister(params.name);
    if (!removed) {
      set.status = 404;
      return { success: false, error: `Service not found: ${params.name}` };
    }
    return { success: true, removed: params.name };
  }, {
    params: t.Object({ name: t.String({ minLength: 1 }) }),
    detail: { tags: ['vector-registry'], summary: 'Unregister one vector service' },
  })
  .post('/vector/services/:name/test', async ({ params }) => {
    const health = await vectorServiceRegistry.healthCheck();
    const result = health.get(params.name);
    return {
      name: params.name,
      status: result?.status ?? 'unknown',
      ...(result || {}),
      success: result?.status === 'up',
    };
  }, {
    params: t.Object({ name: t.String({ minLength: 1 }) }),
    detail: { tags: ['vector-registry'], summary: 'Test one registered vector service' },
  });
