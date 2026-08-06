import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { authRoutes } from '../../../src/routes/auth/index.ts';
import { updateSettingsRoute } from '../../../src/routes/settings/update.ts';
import { createFeedRoute } from '../../../src/routes/feed/create.ts';
import { createHealthRoutes } from '../../../src/routes/health/index.ts';
import { dashboardRoutes } from '../../../src/routes/dashboard/index.ts';
import { searchRoutes } from '../../../src/routes/search/index.ts';
import { createVectorExportEndpoint } from '../../../src/routes/vector/export.ts';
import { knowledgeRoutes } from '../../../src/routes/knowledge/index.ts';
import { supersedeRoutes } from '../../../src/routes/supersede/index.ts';
import { forumApi } from '../../../src/routes/forum/index.ts';
import { tracesApi } from '../../../src/routes/traces/index.ts';
import { scheduleApi } from '../../../src/routes/schedule/index.ts';
import { filesRouter } from '../../../src/routes/files/index.ts';
import { createPluginsRouter } from '../../../src/routes/plugins/index.ts';
import { sessionsRoutes } from '../../../src/routes/sessions/index.ts';
import { createVaultSyncRoute } from '../../../src/routes/vault/sync.ts';
import { metricsRoutes } from '../../../src/routes/metrics/index.ts';
import { createMemoryRoutes } from '../../../src/routes/memory/index.ts';
import { canvasRoutes } from '../../../src/routes/canvas/index.ts';
import { tenantsRoutes } from '../../../src/routes/tenants/index.ts';
import { createMcpRoutes } from '../../../src/routes/mcp/index.ts';
import { indexerRoutes } from '../../../src/routes/indexer/index.ts';
import { daemonApiPlugin } from '../../../src/routes/indexer-daemon/index.ts';
import { createErrorMiddleware } from '../../../src/middleware/errors.ts';
import { createNotFoundMiddleware } from '../../../src/middleware/not-found.ts';

type AnyApp = Elysia<any, any, any, any, any, any, any>;
type Case = {
  cluster: string;
  app: () => AnyApp;
  path: string;
  init?: RequestInit;
  status: number;
  error?: string;
};

function withErrors(route: AnyApp): AnyApp {
  const app = new Elysia().use(createErrorMiddleware(() => undefined)).use(route as never);
  app.use(createNotFoundMiddleware(app.routes));
  return app;
}

function jsonPost(body: unknown): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

async function hit(testCase: Case) {
  const res = await testCase.app().handle(new Request(`http://local${testCase.path}`, testCase.init));
  const body = await res.json() as Record<string, unknown>;
  return { res, body };
}

function expectErrorBody(body: Record<string, unknown>, expected?: string) {
  expect(body.error).toEqual(expect.any(String));
  if (expected) expect(body.error).toBe(expected);
}

const basicCases: Case[] = [
  { cluster: 'auth', app: () => withErrors(authRoutes), path: '/api/auth/login', init: jsonPost({}), status: 400, error: 'Password required' },
  { cluster: 'settings', app: () => withErrors(new Elysia({ prefix: '/api/settings' }).use(updateSettingsRoute)), path: '/api/settings', init: jsonPost({ authEnabled: true }), status: 400, error: 'Cannot enable auth without password' },
  { cluster: 'feed', app: () => withErrors(new Elysia({ prefix: '/api/feed' }).use(createFeedRoute)), path: '/api/feed', init: jsonPost({}), status: 400, error: 'Missing required fields: oracle, event' },
  { cluster: 'health', app: () => withErrors(createHealthRoutes()), path: '/api/health/missing', status: 404, error: 'Not Found' },
  { cluster: 'dashboard', app: () => withErrors(dashboardRoutes), path: '/api/dashboard/missing', status: 404, error: 'Not Found' },
  { cluster: 'search', app: () => withErrors(searchRoutes), path: '/api/search', status: 400, error: 'Missing query parameter: q' },
  { cluster: 'vector', app: () => withErrors(new Elysia({ prefix: '/api' }).use(createVectorExportEndpoint())), path: '/api/vector/export?format=bogus', status: 400, error: 'Invalid format' },
  { cluster: 'knowledge', app: () => withErrors(knowledgeRoutes), path: '/api/learn', init: jsonPost({}), status: 400, error: 'Missing required field: pattern' },
  { cluster: 'supersede', app: () => withErrors(supersedeRoutes), path: '/api/supersede', init: jsonPost({}), status: 400, error: 'Missing required field: old_path' },
  { cluster: 'forum', app: () => withErrors(forumApi), path: '/api/thread/not-a-number', status: 400, error: 'Invalid thread ID' },
  { cluster: 'traces', app: () => withErrors(tracesApi), path: '/api/traces/missing', status: 404, error: 'Trace not found' },
  { cluster: 'schedule', app: () => withErrors(scheduleApi), path: '/api/schedule/missing/nope', status: 404, error: 'Not Found' },
  { cluster: 'files', app: () => withErrors(filesRouter), path: '/api/file', status: 400, error: 'Missing path parameter' },
  { cluster: 'plugins', app: () => withErrors(createPluginsRouter()), path: '/api/plugins/canvas/missing', status: 404, error: 'canvas plugin not found' },
  { cluster: 'sessions', app: () => withErrors(sessionsRoutes), path: '/api/session/s1/summary', init: jsonPost({ summary: '' }), status: 400, error: 'Missing required field: summary' },
  { cluster: 'metrics', app: () => withErrors(metricsRoutes), path: '/api/metrics/missing', status: 404, error: 'Not Found' },
  { cluster: 'memory', app: () => withErrors(createMemoryRoutes()), path: '/api/memory/search', status: 400, error: 'Missing query parameter: q' },
  { cluster: 'canvas', app: () => withErrors(canvasRoutes), path: '/api/canvas/plugins/missing', status: 404, error: 'canvas plugin not found' },
  { cluster: 'tenants', app: () => withErrors(tenantsRoutes), path: '/api/tenants/missing', status: 404, error: 'Tenant not found: missing' },
  { cluster: 'mcp', app: () => withErrors(createMcpRoutes()), path: '/api/mcp/missing', status: 404, error: 'Not Found' },
  { cluster: 'indexer', app: () => withErrors(indexerRoutes), path: '/api/indexer/missing', status: 404, error: 'Not Found' },
];

describe('route-cluster error contracts', () => {
  for (const testCase of basicCases) {
    test(`${testCase.cluster} returns ${testCase.status} with JSON error`, async () => {
      const { res, body } = await hit(testCase);
      expect(res.status).toBe(testCase.status);
      expectErrorBody(body, testCase.error);
    });
  }

  test('vault route failures preserve route-provided 500 message', async () => {
    const route = new Elysia({ prefix: '/api/vault' }).use(createVaultSyncRoute({
      migrate: () => { throw new Error('vault exploded'); },
      spawnIndexer: () => undefined,
    }));
    const { res, body } = await hit({ cluster: 'vault', app: () => withErrors(route), path: '/api/vault/sync', init: jsonPost({}), status: 500 });
    expect(res.status).toBe(500);
    expect(body).toEqual({ ok: false, error: 'vault exploded' });
  });

  test('vector export DB failures preserve 500 error contract', async () => {
    const route = new Elysia({ prefix: '/api' }).use(createVectorExportEndpoint({
      getStore: () => ({ connect: async () => { throw new Error('vector db unavailable'); } } as never),
    }));
    const { res, body } = await hit({ cluster: 'vector', app: () => withErrors(route), path: '/api/vector/export?format=json', status: 500 });
    expect(res.status).toBe(500);
    expect(body).toEqual({ error: 'Vector export failed', message: 'vector db unavailable' });
  });

  test('indexer-daemon validates missing doc_id as a 400 JSON error', async () => {
    const route = daemonApiPlugin({
      db: {} as never,
      models: { bge: { collection: 'bge' } },
      isShuttingDown: () => false,
      requestShutdown: () => undefined,
      subscribe: () => () => undefined,
    });
    const { res, body } = await hit({ cluster: 'indexer-daemon', app: () => withErrors(route), path: '/index', init: jsonPost({}), status: 400 });
    expect(res.status).toBe(400);
    expectErrorBody(body, 'doc_id required');
  });
});
