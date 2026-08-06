/**
 * The Fleet Log routes must be mounted in the composed app, not merely written.
 *
 * The other tests in this directory call `createFleetLogRoutes().handle(request)`, exercising
 * the cluster in isolation — every one of them would still pass if the cluster were never added
 * to `apiModules` in `src/server.ts`. That is the #2877 defect shape: a green suite guarding
 * code production never reaches.
 *
 * Found by booting the real server after #2894 had already merged. It *was* mounted correctly —
 * but nothing would have said so if it were not.
 *
 * Follows the `app.routes` approach from `tests/integration/server-boot/composition.test.ts`
 * rather than issuing requests: it is the existing convention here, and it asserts the mount
 * directly instead of inferring it from a response.
 */
import { describe, expect, test } from 'bun:test';
import { createApp } from '../../../src/server.ts';
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

describe('the Fleet Log cluster is wired into the server', () => {
  const paths = () => createApp({ unifiedPlugins: runtime() }).routes.map((r) => `${r.method} ${r.path}`);

  test('GET /api/fleet-log/search is mounted', () => {
    expect(paths()).toContain('GET /api/fleet-log/search');
  });

  test('GET /api/fleet-log/thread/:key is mounted', () => {
    expect(paths()).toContain('GET /api/fleet-log/thread/:key');
  });

  test('both contract paths from fleetLogMock.ts resolve to real routes', () => {
    // The strings the frontend has been declaring since before the routes existed.
    const mounted = paths();
    for (const path of ['/api/fleet-log/search', '/api/fleet-log/thread/:key']) {
      expect(mounted.some((entry) => entry.endsWith(` ${path}`))).toBe(true);
    }
  });
});
