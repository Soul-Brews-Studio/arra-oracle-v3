import { afterAll, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tempData = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-tools-data-'));
const tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-tools-repo-'));
const previous = {
  data: process.env.ORACLE_DATA_DIR,
  root: process.env.ORACLE_REPO_ROOT,
  allow: process.env.ORACLE_ENABLED_TOOLS,
  block: process.env.ORACLE_DISABLED_TOOLS,
};
process.env.ORACLE_DATA_DIR = tempData;
process.env.ORACLE_REPO_ROOT = tempRepo;
delete process.env.ORACLE_ENABLED_TOOLS;
delete process.env.ORACLE_DISABLED_TOOLS;

// Pin the write target to the repo-root tier. ORACLE_DATA_DIR is read once at
// src/config.ts import and bun shares that module across test files, so the
// global tier is NOT ours to control — without this seed a solo run of this
// file would resolve to (and overwrite) the developer's real global config.
const repoConfig = path.join(tempRepo, 'arra.config.json');
fs.writeFileSync(repoConfig, JSON.stringify({ disabled_tools: [] }) + '\n');

const dbModule = await import('../../../src/db/index.ts');
dbModule.resetDefaultDatabaseForTests(process.env.ORACLE_DB_PATH);
const { settingsRoutes } = await import('../../../src/routes/settings/index.ts');
const { createApiVersionedFetch } = await import('../../../src/middleware/api-version.ts');

// A real listening server, not `.handle()` on an uncompiled app: the direct
// handle path is order-sensitive during module init and has produced phantom
// 404s while the mount was in fact fine. Matches CLAUDE.md's "fetch-based
// against a spawned Elysia server" rule.
const handle = createApiVersionedFetch((request) => settingsRoutes.handle(request));
const server = Bun.serve({ port: 0, fetch: (request) => handle(request) });
const base = `http://127.0.0.1:${server.port}`;

afterAll(() => {
  server.stop(true);
  for (const [key, value] of [
    ['ORACLE_DATA_DIR', previous.data],
    ['ORACLE_REPO_ROOT', previous.root], ['ORACLE_ENABLED_TOOLS', previous.allow],
    ['ORACLE_DISABLED_TOOLS', previous.block],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(tempData, { recursive: true });
  fs.rmSync(tempRepo, { recursive: true });
});

type ToolsBody = {
  groups: Array<{ group: string; tools: Array<{ name: string; enabled: boolean }> }>;
  enabled_tools: string[];
  disabled_tools: string[];
  always_on_tools: string[];
  config_path: string;
  config_exists: boolean;
  env_override: boolean;
};

const readTools = async (): Promise<ToolsBody> => {
  const res = await fetch(`${base}/api/v1/settings/tools`);
  expect(res.status).toBe(200);
  return await res.json() as ToolsBody;
};

test('GET /api/v1/settings/tools is mounted and returns group data', async () => {
  const body = await readTools();
  expect(body.groups.length).toBeGreaterThan(0);
  expect(body.groups.map((entry) => entry.group)).toContain('search');
  const named = body.groups.flatMap((entry) => entry.tools.map((tool) => tool.name));
  expect(named).toContain('oracle_ask');
  expect(named).toContain('oracle_recap');
  expect(body.always_on_tools).toEqual(['oracle_mcp_list_tools', 'oracle_mcp_call']);
  expect(body.env_override).toBe(false);
});

test('the unversioned alias redirects to the versioned path', async () => {
  const res = await fetch(`${base}/api/settings/tools`, { redirect: 'manual' });
  expect(res.status).toBe(308);
  expect(res.headers.get('location')).toContain('/api/v1/settings/tools');
});

test('PUT rejects unknown tool names without writing anything', async () => {
  const res = await fetch(`${base}/api/v1/settings/tools`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled_tools: ['oracle_search', 'not_a_real_tool'] }),
  });
  expect(res.status).toBe(400);
  expect((await res.json() as { unknown: string[] }).unknown).toEqual(['not_a_real_tool']);
});

test('PUT writes a file the loader reads back — the round-trip #2822 lacked', async () => {
  const before = await readTools();
  expect(before.config_path).toBe(repoConfig);
  expect(before.config_exists).toBe(true);
  expect(before.enabled_tools).toContain('oracle_thread');

  const res = await fetch(`${base}/api/v1/settings/tools`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled_tools: ['oracle_search', 'oracle_read'] }),
  });
  expect(res.status).toBe(200);

  const written = JSON.parse(fs.readFileSync(before.config_path, 'utf-8')) as Record<string, string[]>;
  expect(written.enabled_tools).toEqual(['oracle_search', 'oracle_read']);
  expect(written.disabled_tools).toContain('oracle_thread');
  expect(written.allowed_tools).toBeUndefined();

  const after = await readTools();
  expect(after.config_exists).toBe(true);
  expect(after.enabled_tools).toEqual(['oracle_search', 'oracle_read']);
  expect(after.disabled_tools).toContain('oracle_thread');
});
