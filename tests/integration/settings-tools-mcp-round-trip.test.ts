import { afterAll, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/**
 * The cross-process round-trip #2822 never had.
 *
 * `tests/http/settings/tools-mounted.test.ts` proves the settings PUT writes the
 * keys the loader reads. It cannot prove the CONSUMER honours them: every
 * assertion there is answered by the same in-process config module the writer
 * just called. The #2822 defect class is precisely a divergence between the
 * config layer and the MCP tool surface, so a guard against it has to observe
 * the surface from outside.
 *
 * This spawns the REAL stdio entrypoint (`bun src/index.ts`) as a separate OS
 * process — the thing production actually runs — reads tools/list, PUTs a
 * disable through the HTTP settings surface, then spawns a FRESH process and
 * reads tools/list again. A fresh spawn rather than the config watcher because
 * that watcher is a 100ms poller with a 200ms debounce
 * (src/config/tool-groups-watch.ts) — timing, not determinism.
 *
 * Assertions are relational (which names disappeared), never a hardcoded count:
 * the tool registry grows, and a 30 -> 26 assertion would rot into noise.
 */

const REPO_ROOT = new URL('../../', import.meta.url).pathname.replace(/\/$/, '');

/**
 * `oracle_mcp_call` is load-bearing and must stay in this list. It is an
 * ALWAYS_ON tool (src/config/tool-groups-core.ts:23) — on by DEFAULT, but still
 * explicitly disableable. Re-introducing a lock there is the #2822 regression
 * this file exists to catch, and without this name the test would not catch it.
 */
const VICTIMS = ['oracle_ask', 'oracle_mcp_call', 'oracle_recap', 'oracle_thread'];
const VICTIM_SET = new Set(VICTIMS);

const tempData = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-roundtrip-data-'));
const tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-roundtrip-repo-'));
const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-roundtrip-home-'));
const tempDbPath = path.join(tempData, 'oracle.db');

const previous = {
  data: process.env.ORACLE_DATA_DIR,
  db: process.env.ORACLE_DB_PATH,
  root: process.env.ORACLE_REPO_ROOT,
  allow: process.env.ORACLE_ENABLED_TOOLS,
  block: process.env.ORACLE_DISABLED_TOOLS,
};
process.env.ORACLE_DATA_DIR = tempData;
process.env.ORACLE_DB_PATH = tempDbPath;
process.env.ORACLE_REPO_ROOT = tempRepo;
delete process.env.ORACLE_ENABLED_TOOLS;
delete process.env.ORACLE_DISABLED_TOOLS;

/**
 * Seed the repo-root tier so it wins resolution. The settings route resolves its
 * write target from `process.env.ORACLE_REPO_ROOT` at REQUEST time
 * (src/routes/settings/tools.ts:24-26), not from the frozen REPO_ROOT constant —
 * that is what keeps this test off the developer's real ~/.arra-oracle-v2 config.
 * The `config_path` assertion below pins that behaviour: if the route ever
 * switches to the module constant, this test fails instead of eating live config.
 */
const repoConfig = path.join(tempRepo, 'arra.config.json');
fs.writeFileSync(repoConfig, JSON.stringify({ disabled_tools: [] }) + '\n');

const dbModule = await import('../../src/db/index.ts');
dbModule.resetDefaultDatabaseForTests(tempDbPath);
const { settingsRoutes } = await import('../../src/routes/settings/index.ts');
const { createApiVersionedFetch } = await import('../../src/middleware/api-version.ts');

const handle = createApiVersionedFetch((request) => settingsRoutes.handle(request));
const server = Bun.serve({ port: 0, fetch: (request) => handle(request) });
const base = `http://127.0.0.1:${server.port}`;

afterAll(() => {
  server.stop(true);
  for (const [key, value] of [
    ['ORACLE_DATA_DIR', previous.data], ['ORACLE_DB_PATH', previous.db],
    ['ORACLE_REPO_ROOT', previous.root], ['ORACLE_ENABLED_TOOLS', previous.allow],
    ['ORACLE_DISABLED_TOOLS', previous.block],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const dir of [tempData, tempRepo, tempHome]) fs.rmSync(dir, { recursive: true });
});

/**
 * One fresh stdio MCP process, its tools/list, then gone.
 *
 * ORACLE_HTTP_URL puts the child in HTTP-proxy mode, which short-circuits
 * preConnectVector() (src/mcp/server.ts) — no vector store, no embedder probe,
 * ~150ms a spawn. Safe because availableTools() does not branch on the proxy
 * base: the tool list is computed identically in both modes.
 */
async function listMcpTools(): Promise<string[]> {
  const transport = new StdioClientTransport({
    command: 'bun',
    args: [path.join(REPO_ROOT, 'src/index.ts')],
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      HOME: tempHome,
      ORACLE_DATA_DIR: tempData,
      ORACLE_DB_PATH: tempDbPath,
      ORACLE_REPO_ROOT: tempRepo,
      ORACLE_HTTP_URL: base,
      ORACLE_API: base,
      ORACLE_EMBEDDER: 'none',
      ORACLE_INDEXER_ENQUEUE: '0',
      ORACLE_TOOL_GROUPS_HOT_RELOAD: '0',
      ARRA_PLUGIN_HOT_RELOAD: '0',
    } as Record<string, string>,
    stderr: 'pipe',
  });
  const client = new Client({ name: 'arra-settings-round-trip', version: '0.0.0' }, { capabilities: {} });
  try {
    await client.connect(transport);
    return (await client.listTools()).tools.map((tool) => tool.name).sort();
  } finally {
    await client.close().catch(() => undefined);
  }
}

type ToolsBody = { enabled_tools: string[]; config_path: string; env_override: boolean };

test('a settings PUT changes the tool surface of a real stdio MCP process', async () => {
  const before = await listMcpTools();
  // Vacuity guard: if the victims were not on the surface to begin with, a later
  // "they are gone" would prove nothing.
  for (const victim of VICTIMS) expect(before).toContain(victim);

  const read = await fetch(`${base}/api/v1/settings/tools`);
  expect(read.status).toBe(200);
  const current = await read.json() as ToolsBody;
  expect(current.config_path).toBe(repoConfig);
  expect(current.env_override).toBe(false);

  const keep = current.enabled_tools.filter((name) => !VICTIM_SET.has(name));
  expect(keep.length).toBe(current.enabled_tools.length - VICTIMS.length);

  const wrote = await fetch(`${base}/api/v1/settings/tools`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled_tools: keep }),
  });
  expect(wrote.status).toBe(200);

  const after = await listMcpTools();
  const removed = before.filter((name) => !after.includes(name));
  const added = after.filter((name) => !before.includes(name));

  // THE assertion. Exactly the four names the PUT disabled left the MCP surface —
  // no more (the PUT did not collaterally kill unrelated tools), no fewer (every
  // victim, ALWAYS_ON ones included, actually went away).
  expect(removed).toEqual([...VICTIMS].sort());
  expect(added).toEqual([]);
}, 90_000);
