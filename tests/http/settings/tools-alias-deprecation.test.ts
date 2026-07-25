import { afterAll, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tempData = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-alias-data-'));
const tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-alias-repo-'));
const previous = {
  data: process.env.ORACLE_DATA_DIR,
  db: process.env.ORACLE_DB_PATH,
  root: process.env.ORACLE_REPO_ROOT,
  allow: process.env.ORACLE_ENABLED_TOOLS,
  block: process.env.ORACLE_DISABLED_TOOLS,
};
process.env.ORACLE_DATA_DIR = tempData;
process.env.ORACLE_DB_PATH = path.join(tempData, 'oracle.db');
process.env.ORACLE_REPO_ROOT = tempRepo;
delete process.env.ORACLE_ENABLED_TOOLS;
delete process.env.ORACLE_DISABLED_TOOLS;

// Pin the write target to the repo-root tier — see tools-mounted.test.ts. Without
// this seed the resolver falls through to $ORACLE_DATA_DIR/config.json, whose path
// was fixed at src/config.ts import time, and the PUT would overwrite the
// developer's REAL global config. (This is not hypothetical: it happened while
// probing this defect.)
const repoConfig = path.join(tempRepo, 'arra.config.json');
fs.writeFileSync(repoConfig, JSON.stringify({ disabled_tools: [] }) + '\n');

const dbModule = await import('../../../src/db/index.ts');
dbModule.resetDefaultDatabaseForTests(process.env.ORACLE_DB_PATH);
const { settingsRoutes } = await import('../../../src/routes/settings/index.ts');
const { createApiVersionedFetch } = await import('../../../src/middleware/api-version.ts');

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
  fs.rmSync(tempData, { recursive: true });
  fs.rmSync(tempRepo, { recursive: true });
});

/** PUT the body, returning the response plus only the deprecation lines it logged. */
async function putCapturingWarnings(enabled_tools: string[]): Promise<{ res: Response; warnings: string[] }> {
  const lines: string[] = [];
  const real = console.error;
  console.error = (...args: unknown[]) => { lines.push(args.join(' ')); };
  try {
    const res = await fetch(`${base}/api/v1/settings/tools`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled_tools }),
    });
    // Body must be drained before restoring: the handler logs while serializing.
    await res.clone().text();
    return { res, warnings: lines.filter((line) => line.includes('is deprecated')) };
  } finally {
    console.error = real;
  }
}

test('PUT /api/v1/settings/tools warns that a muninn_ name is deprecated, and still resolves it', async () => {
  const { res, warnings } = await putCapturingWarnings(['muninn_search', 'oracle_list']);
  expect(res.status).toBe(200);

  // Exact format, shared with the MCP path via deprecatedAliasWarning.
  expect(warnings).toEqual([
    '[MCP] tool alias "muninn_search" is deprecated — use "oracle_search" (removal planned next release)',
  ]);

  // Warning is an announcement, not a rejection — the rewrite still happens.
  const written = JSON.parse(fs.readFileSync(repoConfig, 'utf-8')) as Record<string, string[]>;
  expect(written.enabled_tools).toEqual(['oracle_search', 'oracle_list']);
  expect((await res.json() as { enabled_tools: string[] }).enabled_tools).toEqual(['oracle_search', 'oracle_list']);
});

test('PUT /api/v1/settings/tools stays silent for arra_ names, and still resolves them', async () => {
  const { res, warnings } = await putCapturingWarnings(['arra_read', 'oracle_list']);
  expect(res.status).toBe(200);

  // arra_ is supported, not deprecated — warning about it would be a false alarm.
  expect(warnings).toEqual([]);

  const written = JSON.parse(fs.readFileSync(repoConfig, 'utf-8')) as Record<string, string[]>;
  expect(written.enabled_tools).toEqual(['oracle_read', 'oracle_list']);
  expect((await res.json() as { enabled_tools: string[] }).enabled_tools).toEqual(['oracle_read', 'oracle_list']);
});

test('a second PUT re-warns — each PUT is a fresh operator action, not a polled re-read', async () => {
  const first = await putCapturingWarnings(['muninn_read', 'oracle_list']);
  expect(first.warnings).toHaveLength(1);
  const second = await putCapturingWarnings(['muninn_read', 'oracle_list']);
  expect(second.warnings).toEqual(first.warnings);
});
