/**
 * End-to-end proof that connecting an MCP client starts the Oracle HTTP daemon.
 *
 * Before this, the ONLY thing on the MCP path that touched the daemon was `ensureProxyTarget()`,
 * fired on the first tool call and only in HTTP-proxy mode — so the default embedded registration
 * never started :47778 at all and the web UIs stayed dark until someone ran `bun run server`.
 *
 * Both cases point the child at a STUB on a free port via ORACLE_PORT (read at import time by
 * src/config.ts), so nothing here can spawn a daemon on the real 47778:
 *   - healthy stub  → `ensureServerRunning()` returns at its first health check. No lock, no spawn.
 *   - hanging stub  → the child parks in `isPortInUse`'s unbounded fetch, which sits BEFORE
 *                     `spawnDaemon()`. Still no spawn, and the warm never resolves — which is
 *                     exactly what makes it a real test of the fire-and-forget contract.
 */
import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const repoRoot = resolve(import.meta.dir, '../..');
const tempDirs: string[] = [];
const servers: ReturnType<typeof Bun.serve>[] = [];
const pending: Array<(response: Response) => void> = [];

afterEach(async () => {
  for (const settle of pending.splice(0)) settle(new Response('', { status: 503 }));
  for (const server of servers.splice(0)) await server.stop(true);
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Stands in for the daemon so the child's health URL never points at the real :47778. */
function stubDaemon(handler: (path: string) => Response | Promise<Response>) {
  const server = Bun.serve({ port: 0, fetch: (request) => handler(new URL(request.url).pathname) });
  servers.push(server);
  return server;
}

function childEnv(port: number, extra: Record<string, string> = {}): Record<string, string> {
  const root = mkdtempSync(join(tmpdir(), 'arra-autostart-http-'));
  tempDirs.push(root);
  const home = join(root, 'home');
  const dataDir = join(root, 'data');
  mkdirSync(home, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  return {
    ...process.env,
    HOME: home,
    ORACLE_DATA_DIR: dataDir,
    ORACLE_DB_PATH: join(dataDir, 'oracle.db'),
    ORACLE_PORT: String(port),
    // Embedded mode: the registration Claude Code actually uses, and the case that was broken.
    ORACLE_HTTP_URL: '',
    ORACLE_API: '',
    NEO_ARRA_API: '',
    ORACLE_MCP_AUTOSTART_HTTP: '1',
    ORACLE_EMBEDDER: 'none',
    ORACLE_INDEXER_ENQUEUE: '0',
    ORACLE_TOOL_GROUPS_HOT_RELOAD: '0',
    ARRA_PLUGIN_HOT_RELOAD: '0',
    ...extra,
  } as Record<string, string>;
}

function connectStdioClient(env: Record<string, string>) {
  const transport = new StdioClientTransport({
    command: 'bun',
    args: [join(repoRoot, 'src/index.ts')],
    cwd: repoRoot,
    env,
    stderr: 'pipe',
  });
  const client = new Client({ name: 'arra-autostart-http-test', version: '0.0.0' }, { capabilities: {} });
  return { client, connected: client.connect(transport) };
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await Bun.sleep(50);
  }
  return predicate();
}

test('connecting in embedded mode starts the HTTP daemon without waiting for a tool call', async () => {
  const hits: string[] = [];
  const stub = stubDaemon((path) => {
    hits.push(path);
    return Response.json({ status: 'ok' });
  });

  const { client, connected } = connectStdioClient(childEnv(stub.port));
  try {
    await connected;
    // The assertion that fails without the change: NO tool has been called, yet the daemon has
    // already been ensured. Previously the first `/api/health` only happened on tools/call.
    expect(await waitFor(() => hits.includes('/api/health'), 15_000)).toBe(true);

    const listed = await client.listTools();
    expect(listed.tools.length).toBeGreaterThan(0);
  } finally {
    await client.close().catch(() => undefined);
  }
}, 40_000);

test('a daemon that never answers cannot stall the MCP handshake', async () => {
  // Both endpoints hang. `ensureServerRunning()` therefore never returns for the lifetime of this
  // test, so if `warmHttpDaemon()` were ever awaited before `server.connect(transport)` the
  // initialize below would time out instead of succeeding.
  const stub = stubDaemon(() => new Promise<Response>((settle) => pending.push(settle)));

  const { client, connected } = connectStdioClient(childEnv(stub.port));
  try {
    await connected;
    const listed = await client.listTools();
    expect(listed.tools.length).toBeGreaterThan(0);
  } finally {
    await client.close().catch(() => undefined);
  }
}, 40_000);
