import { afterEach, expect, test } from 'bun:test';
import { withProxyServer } from './support/server.ts';
import { setEmbedderRuntimeStatus } from '../../src/vector/embedder-config.ts';

/**
 * This asserted `vectorStatus === 'unknown'`, which encoded "nothing ever probed" — the test
 * bypasses `initEmbedded()`, so no boot probe ran.
 *
 * `getToolCtx()` now reads `readEmbedderRuntimeStatus()` instead of the stored snapshot
 * (#2817), so an unprobed context probes for real and reports `degraded` where no embedder is
 * reachable. That is the improvement, and `'unknown'` was pinning its absence.
 *
 * Seeding a fresh status first mirrors what production does — `initEmbedded()` probes at boot
 * and stamps `checkedAt`, so the TTL short-circuits and `getToolCtx()` costs nothing. It also
 * keeps this test off the network and deterministic.
 */
afterEach(() => {
  setEmbedderRuntimeStatus({ status: 'unknown', provider: 'ollama' } as never);
});

function readyServer() {
  const server = withProxyServer();
  (server as any).embeddedReady = Promise.resolve();
  (server as any).sqlite = { close: () => {} };
  (server as any).db = { marker: true };
  (server as any).vectorStore = { close: async () => {} };
  return server;
}

test('MCP server tool context returns initialized resources', async () => {
  const server = readyServer();
  try {
    setEmbedderRuntimeStatus({
      status: 'connected',
      provider: 'ollama',
      checkedAt: new Date().toISOString(),
    } as never);

    const ctx = await (server as any).getToolCtx();

    expect(ctx.db).toEqual({ marker: true });
    expect(ctx.sqlite).toBeDefined();
    expect(ctx.vectorStore).toBeDefined();
    expect(ctx.vectorStatus).toBe('connected');
  } finally {
    await server.cleanup();
  }
});

test('the tool context reflects a degraded embedder rather than a boot-time value', async () => {
  const server = readyServer();
  try {
    // The #2817 scenario: the embedder died. A context that still said "connected" is what
    // sent an operator debugging in the wrong direction for a session.
    setEmbedderRuntimeStatus({
      status: 'degraded',
      provider: 'ollama',
      reason: 'model failed to load',
      checkedAt: new Date().toISOString(),
    } as never);

    const ctx = await (server as any).getToolCtx();

    expect(ctx.vectorStatus).toBe('degraded');
    expect(ctx.vectorReason).toContain('model failed to load');
  } finally {
    await server.cleanup();
  }
});
