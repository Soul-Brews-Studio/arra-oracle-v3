/**
 * Embedded mode is default-OFF, and this file is also the guard that keeps the rest of the suite
 * from spawning a daemon: it deletes ORACLE_MCP_AUTOSTART_HTTP from the environment first, so a
 * developer who exported the opt-in in their shell cannot turn a test run into a real spawn on
 * :47778 against a temp database.
 *
 * Separate file from the proxy-mode test because `withProxyServer()` sets ORACLE_HTTP_URL and
 * never restores it.
 */
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OracleMCPServer } from '../../src/mcp/server.ts';
import { clearEmbedderRuntimeStatusForTests } from '../../src/vector/embedder-config.ts';
import { allToolGroups } from './support/server.ts';

const PROXY_VARS = ['ORACLE_HTTP_URL', 'ORACLE_API', 'NEO_ARRA_API', 'ORACLE_MCP_AUTOSTART_HTTP'] as const;
const saved = new Map<string, string | undefined>();
let dataDir = '';

beforeEach(() => {
  for (const key of PROXY_VARS) { saved.set(key, process.env[key]); delete process.env[key]; }
  dataDir = mkdtempSync(join(tmpdir(), 'arra-warm-embedded-'));
});

afterEach(() => {
  for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  saved.clear();
  clearEmbedderRuntimeStatusForTests();
  rmSync(dataDir, { recursive: true, force: true });
});

test('embedded mode without the opt-in warms nothing: no spawn, no lock, no PID file', async () => {
  const vectorStore = { name: 'fake', getStats: async () => ({ count: 0 }), close: async () => {} };
  const server = new OracleMCPServer({
    toolGroups: allToolGroups,
    embeddedDeps: {
      createVectorStoreForModel: () => vectorStore as any,
      getEmbeddingModels: () => ({ 'bge-m3': {} }),
      createDatabase: () => ({ sqlite: { close: () => {} } as any, db: {} as any }),
      probeEmbedder: async () => ({ status: 'connected', provider: 'none', source: 'auto-default', explicit: false }),
    },
  });
  try {
    expect((server as any).oracleApiBase).toBeNull();
    const started = Date.now();
    server.warmHttpDaemon();
    await expect((server as any).proxyReady).resolves.toBeUndefined();
    // ensureServerRunning would poll health for 15s before giving up; returning instantly is the
    // proof that the embedded branch short-circuits before it is ever imported.
    expect(Date.now() - started).toBeLessThan(1000);
    expect(existsSync(join(dataDir, 'oracle-http.lock'))).toBe(false);
    expect(existsSync(join(dataDir, 'oracle-http.pid'))).toBe(false);
  } finally {
    await server.cleanup();
  }
});
