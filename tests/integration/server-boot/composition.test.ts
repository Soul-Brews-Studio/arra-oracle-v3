import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createApp, createServerRouteModules, mountRouteModules } from '../../../src/server.ts';
import { createUnifiedRuntimeRef } from '../../../src/plugins/runtime-routes.ts';
import type { UnifiedRuntime } from '../../../src/plugins/unified-loader.ts';

function runtime(): UnifiedRuntime {
  return {
    pluginCount: 0,
    routes: [],
    mcpTools: [],
    menu: [],
    cliSubcommands: [],
    servers: [],
    callMcpTool: async () => ({}),
    pluginStatuses: () => [],
    pluginRegistry: () => [],
    init: async () => {},
    reload: async () => {},
    stop: async () => {},
  };
}

describe('server createApp composition', () => {
  test('mounts core routes before plugin catch-all and not-found boundary', async () => {
    const app = createApp({ unifiedPlugins: runtime() });
    const paths = app.routes.map((route) => `${route.method} ${route.path}`);

    expect(paths).toContain('GET /');
    expect(paths).toContain('GET /api/health');
    expect(paths.indexOf('GET /api/health')).toBeLessThan(paths.length - 1);

    const root = await app.fetch(new Request('http://server.test/'));
    expect(root.status).toBe(200);
    expect(await root.json()).toMatchObject({ status: 'ok', docs: '/api/docs' });
  });

  test('keeps structured error boundary active for composed routes', async () => {
    const app = createApp({ unifiedPlugins: runtime() })
      .get('/api/__boot_throw', () => { throw new Error('boot exploded'); });

    const res = await app.fetch(new Request('http://server.test/api/__boot_throw', {
      headers: { 'x-request-id': 'boot-test' },
    }));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toMatchObject({ success: false, error: 'Internal Server Error', code: 500 });
    expect(body.details).toMatchObject({ message: 'boot exploded', correlationId: 'boot-test' });
  });

  test('rejects invalid route modules with a boot-time error', () => {
    const app = new Elysia();

    expect(() => mountRouteModules(app, [undefined as never])).toThrow('Invalid server route module at index 0');
  });

  test('builds route modules in API then MCP then menu order', () => {
    const current = runtime();
    const modules = createServerRouteModules(current, createUnifiedRuntimeRef(current));
    const routePaths = modules.map((mod) => (mod as Elysia).routes.map((route) => route.path));

    expect(routePaths[0]).toContain('/api/auth/login');
    expect(routePaths.at(-2)?.some((path) => path.includes('/mcp'))).toBe(true);
    expect(routePaths.at(-1)).toContain('/api/menu');
  });
});
