/**
 * Every API route cluster must stay mounted in the composed app.
 *
 * `src/server.ts` composes **33** route clusters into `apiModules`. Before this test, the only
 * mount assertions anywhere were four paths in `composition.test.ts` — `/`, `/api/health`,
 * `/api/auth/login`, `/api/menu`. Everything else could be dropped from `apiModules` and no
 * test would notice.
 *
 * That is not hypothetical. It was found in `tests/http/fleet-log/`, where **31 tests passed
 * against a completely unmounted cluster** because they all call
 * `createFleetLogRoutes().handle(request)` — the cluster in isolation. Most route clusters here
 * are tested the same way, which is fine for behaviour and blind to wiring (#2879, #2923).
 *
 * ## Why segments rather than full paths
 *
 * Pinning all 201 `/api` paths would fail on every legitimate route addition and quickly get
 * deleted. The first segment after `/api` is a good proxy for "this cluster is present": adding
 * routes never removes a segment, so the guard only fires when a whole cluster disappears —
 * which is exactly the failure it exists to catch.
 *
 * Same shape as the file-size ratchet beside it: a list that may only shrink deliberately,
 * never by accident.
 *
 * Lives in tests/build/ rather than tests/integration/server-boot/ ON PURPOSE — CI does not run
 * tests/integration/ (it needs docker), and a guard that never runs is worthless. That exclusion
 * is also why composition.test.ts sat red on alpha unnoticed.
 */
import { describe, expect, test } from 'bun:test';
import { createApp } from '../../src/server.ts';
import type { UnifiedRuntime } from '../../src/plugins/unified-loader.ts';

/** No plugins: this asserts the CORE clusters, not anything a plugin contributes. */
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

/**
 * Every `/api/<segment>` present on 2026-07-27, verified identical across repeated boots.
 *
 * Removing an entry is a deliberate act — it means a cluster was intentionally retired, and the
 * commit that does it should say so.
 */
const REQUIRED_SEGMENTS = [
  'ask', 'auth', 'canvas', 'capture', 'compare', 'concepts', 'context', 'dashboard', 'doc',
  'docs', 'export', 'feed', 'file', 'fleet-log', 'gateway', 'graph', 'handoff', 'health',
  'inbox', 'indexer', 'learn', 'list', 'logs', 'map', 'map3d', 'mcp', 'memory', 'menu',
  'metrics', 'openapi.json', 'oracles', 'plugins', 'read', 'reflect', 'research', 'schedule',
  'search', 'send', 'session', 'sessions', 'settings', 'similar', 'stats', 'supersede',
  'tenants', 'thread', 'threads', 'traces', 'v1', 'vault', 'vector', 'verify', 'watcher',
] as const;

function apiSegments(): Set<string> {
  const app = createApp({ unifiedPlugins: runtime() });
  return new Set(
    app.routes
      .map((route) => route.path)
      .filter((path) => path.startsWith('/api'))
      .map((path) => path.split('/')[2] ?? ''),
  );
}

describe('no API cluster silently disappears', () => {
  const mounted = apiSegments();

  for (const segment of REQUIRED_SEGMENTS) {
    test(`/api/${segment} is mounted`, () => {
      expect(mounted.has(segment)).toBe(true);
    });
  }

  test('the composed app still serves a substantial API surface', () => {
    /**
     * A floor rather than an exact count: routes get added often and legitimately, but losing
     * ~a third of them at once is a composition mistake, not a refactor. 201 today.
     */
    const app = createApp({ unifiedPlugins: runtime() });
    const apiRoutes = app.routes.filter((route) => route.path.startsWith('/api'));
    expect(apiRoutes.length).toBeGreaterThanOrEqual(150);
  });
});

describe('the guard can actually fail', () => {
  test('a segment that was never mounted is reported missing', () => {
    // A guard that cannot fail is worse than no guard (#2847).
    expect(apiSegments().has('definitely-not-a-real-cluster')).toBe(false);
  });
});
