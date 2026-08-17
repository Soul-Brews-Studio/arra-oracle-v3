/**
 * The eager warm and the lazy first-tool-call must share ONE promise.
 *
 * If `warmHttpDaemon()` used its own field, a client that connects and immediately calls a tool
 * would run two `ensureServerRunning()` passes concurrently — two health-check chains racing for
 * the same start lock, for no benefit.
 *
 * The proxy target here is port 1, which `isLocalDaemonTarget()` refuses, so nothing can spawn.
 */
import { expect, test } from 'bun:test';
import { withProxyServer } from './support/server.ts';

test('warmHttpDaemon memoizes into the same promise the tool-call path awaits', async () => {
  const server = withProxyServer();
  try {
    server.warmHttpDaemon();
    const first = (server as any).proxyReady as Promise<void>;
    expect(first).toBeInstanceOf(Promise);
    await expect(first).resolves.toBeUndefined();

    server.warmHttpDaemon();
    expect((server as any).proxyReady).toBe(first);
  } finally {
    await server.cleanup();
  }
});
