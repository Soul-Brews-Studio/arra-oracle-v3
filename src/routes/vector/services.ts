/** Vector service registry API. Mounted under /api. */
import { Elysia, t } from 'elysia';
import {
  vectorServiceRegistry,
  type HealthStatus,
  type RegisteredVectorService,
  type VectorServiceRegistryClient,
} from '../../vector/service-registry.ts';

const capabilitySchema = t.Record(t.String(), t.Unknown());

export interface VectorServicesApiOptions {
  afterChange?: () => Promise<{ reloaded?: number } | void> | { reloaded?: number } | void;
}

async function defaultAfterChange(): Promise<{ reloaded: number }> {
  const { reloadCachedVectorStores } = await import('../../vector/factory.ts');
  return reloadCachedVectorStores();
}

function reloadResult(result: { reloaded?: number } | void): { reloaded?: number } {
  return typeof result?.reloaded === 'number' ? { reloaded: result.reloaded } : {};
}

export function createVectorServicesApiEndpoint(
  registry: VectorServiceRegistryClient = vectorServiceRegistry,
  options: VectorServicesApiOptions = {},
) {
  const afterChange = options.afterChange ?? defaultAfterChange;
  return new Elysia()
    .get('/vector/services', async () => {
      const services = await registry.discover();
      const health = await registry.healthCheck();
      const list = services.map((service) => ({
        ...service,
        health: health.get(service.name) ?? ({ status: 'unknown', checkedAt: new Date().toISOString() } as HealthStatus),
      }));
      return { services: list, count: list.length };
    }, {
      detail: { tags: ['vector-registry'], summary: 'List registered vector services' },
    })
    .post('/vector/services/register', async ({ body, set }) => {
      let service: RegisteredVectorService;
      try {
        service = await registry.register(body as RegisteredVectorService);
      } catch (error) {
        set.status = 400;
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
      return { success: true, service, ...reloadResult(await afterChange()) };
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
      const removed = await registry.unregister(params.name);
      if (!removed) {
        set.status = 404;
        return { success: false, error: `Service not found: ${params.name}` };
      }
      return { success: true, removed: params.name, ...reloadResult(await afterChange()) };
    }, {
      params: t.Object({ name: t.String({ minLength: 1 }) }),
      detail: { tags: ['vector-registry'], summary: 'Unregister one vector service' },
    })
    .post('/vector/services/:name/test', async ({ params, set }) => {
      const services = await registry.discover();
      if (!services.some((service) => service.name === params.name)) {
        set.status = 404;
        return { success: false, error: `Service not found: ${params.name}` };
      }
      const health = await registry.healthCheck();
      const result = health.get(params.name);
      const status = result?.status ?? 'unknown';
      if (status !== 'up') set.status = 503;
      return {
        name: params.name,
        status,
        ...(result || {}),
        success: status === 'up',
      };
    }, {
      params: t.Object({ name: t.String({ minLength: 1 }) }),
      detail: { tags: ['vector-registry'], summary: 'Test one registered vector service' },
    });
}

export const vectorServicesApiEndpoint = createVectorServicesApiEndpoint();
