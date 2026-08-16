/**
 * The policy split that makes eager auto-start safe to ship.
 *
 * Embedded mode must NOT start a daemon by default. The suite spawns `src/index.ts` in embedded
 * mode with a temp ORACLE_DATA_DIR but the real default port; `spawnDaemon` inherits that env and
 * detaches, and the temp dir is deleted afterwards. Default-on would leave a detached daemon on
 * :47778 serving a deleted database. Every dependency here is injected, so nothing in this file
 * can spawn or fetch anything.
 */
import { describe, expect, test } from 'bun:test';
import { ensureHttpDaemon } from '../autostart-http.ts';

const LOCAL = 'http://127.0.0.1:47778';

describe('ensureHttpDaemon in embedded mode (apiBase === null)', () => {
  test('does nothing when the flag is unset — the default registration must stay inert', async () => {
    let called = 0;
    await ensureHttpDaemon(null, { env: {}, ensureLocal: async () => { called++; } });
    expect(called).toBe(0);
  });

  test('starts the daemon exactly once when explicitly opted in', async () => {
    let called = 0;
    await ensureHttpDaemon(null, {
      env: { ORACLE_MCP_AUTOSTART_HTTP: '1' },
      ensureLocal: async () => { called++; },
    });
    expect(called).toBe(1);
  });

  test('a failed start resolves instead of throwing: MCP tools work without the daemon', async () => {
    await expect(ensureHttpDaemon(null, {
      env: { ORACLE_MCP_AUTOSTART_HTTP: '1' },
      ensureLocal: async () => { throw new Error('spawn failed'); },
    })).resolves.toBeUndefined();
  });
});

describe('ensureHttpDaemon in HTTP-proxy mode', () => {
  test('warms the proxy target by default — a proxy client is broken without it', async () => {
    const seen: string[] = [];
    let local = 0;
    await ensureHttpDaemon(LOCAL, {
      env: {},
      ensureProxy: async (base) => { seen.push(base); },
      ensureLocal: async () => { local++; },
    });
    expect(seen).toEqual([LOCAL]);
    expect(local).toBe(0);
  });

  test('the kill switch reaches the lazy first-tool-call path too, not just the eager warm', async () => {
    let called = 0;
    await ensureHttpDaemon(LOCAL, {
      env: { ORACLE_MCP_AUTOSTART_HTTP: '0' },
      ensureProxy: async () => { called++; },
    });
    expect(called).toBe(0);
  });
});
