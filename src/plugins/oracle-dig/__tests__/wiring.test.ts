import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Elysia } from 'elysia';

import { closeDb, db, oracleFindingEvidence, oracleFindings, resetDefaultDatabaseForTests } from '../../../db/index.ts';
import { createApiVersionedFetch } from '../../../middleware/api-version.ts';
import { OracleMCPServer } from '../../../mcp/server.ts';
import { loadUnifiedPlugins } from '../../unified-loader.ts';
import { createPluginsRouter } from '../../../routes/plugins/index.ts';

const pluginsDir = join(process.cwd(), 'src/plugins');
const manifestPath = join(pluginsDir, 'oracle-dig/plugin.json');
const toolGroups = { search: true, knowledge: true, session: true, forum: true, oracle: true, trace: true, standalone: true };
let tmp = '';
let manifest = '';
let previousDb: string | undefined;
let previousDirs: string | undefined;
let previousHttp: string | undefined;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'oracle-dig-wiring-'));
  manifest = readFileSync(manifestPath, 'utf8');
  previousDb = process.env.ORACLE_DB_PATH;
  previousDirs = process.env.ARRA_PLUGIN_DIRS;
  previousHttp = process.env.ORACLE_HTTP_URL;
  process.env.ORACLE_DB_PATH = join(tmp, 'oracle.db');
  process.env.ARRA_PLUGIN_DIRS = pluginsDir;
  process.env.ORACLE_HTTP_URL = 'http://127.0.0.1:1';
  resetDefaultDatabaseForTests(process.env.ORACLE_DB_PATH);
});

afterEach(() => {
  writeFileSync(manifestPath, manifest, 'utf8');
  closeDb();
  restoreEnv('ORACLE_DB_PATH', previousDb);
  restoreEnv('ARRA_PLUGIN_DIRS', previousDirs);
  restoreEnv('ORACLE_HTTP_URL', previousHttp);
  rmSync(tmp, { recursive: true, force: true });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function sessionRoot(): string {
  const root = join(tmp, 'claude-projects');
  const project = join(root, 'arra-oracle-v3');
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, 'session-2781.jsonl'), [
    JSON.stringify({ sessionId: 'session-2781', timestamp: '2026-07-12T00:00:00.000Z', message: { role: 'user', content: 'wire oracle_dig' } }),
    JSON.stringify({ sessionId: 'session-2781', timestamp: '2026-07-12T00:01:00.000Z', message: { role: 'assistant', model: '[m5:digger]', content: 'found plugin wiring evidence' } }),
  ].join('\n'));
  return root;
}

async function callMcpTool(server: OracleMCPServer, name: string, args: Record<string, unknown>) {
  const raw = (server as any).server._requestHandlers.get('tools/call') as (request: unknown) => Promise<any>;
  return raw({ method: 'tools/call', params: { name, arguments: args } });
}

async function pluginRegistryBody(runtime: Awaited<ReturnType<typeof loadUnifiedPlugins>>) {
  const app = new Elysia().use(createPluginsRouter({ dir: pluginsDir, registry: runtime.pluginRegistry, runtime }));
  const fetch = createApiVersionedFetch((request) => app.handle(request));
  const response = await fetch(new Request('http://local/api/v1/plugins'));
  expect(response.status).toBe(200);
  return response.json() as Promise<{ plugins: Array<Record<string, any>> }>;
}

describe('oracle-dig unified plugin wiring', () => {
  test('registers tools, toggles live, and stores a real MCP dig call', async () => {
    const runtime = await loadUnifiedPlugins({ dirs: [pluginsDir] });
    const body = await pluginRegistryBody(runtime);
    const plugin = body.plugins.find((entry) => entry.name === 'oracle-dig');

    expect(plugin).toMatchObject({ name: 'oracle-dig', surfaces: ['mcpTools', 'apiRoutes', 'menu'] });
    expect(plugin?.mcpTools.map((tool: Record<string, unknown>) => tool.name).sort()).toEqual(['oracle_dig', 'oracle_sessions']);

    const app = new Elysia().use(createPluginsRouter({ dir: pluginsDir, registry: runtime.pluginRegistry, runtime }));
    const off = await app.handle(new Request('http://local/api/plugins/oracle-dig/toggle', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: false }),
    }));
    expect(off.status).toBe(200);
    expect((await off.json()) as unknown).toMatchObject({ ok: true, plugin: 'oracle-dig', mcpTools: [] });
    expect(runtime.mcpTools.map((tool) => tool.name)).not.toContain('oracle_dig');

    const on = await app.handle(new Request('http://local/api/plugins/oracle-dig/toggle', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true }),
    }));
    expect(on.status).toBe(200);
    expect((await on.json()) as unknown).toMatchObject({ ok: true, plugin: 'oracle-dig', mcpTools: ['oracle_dig', 'oracle_sessions'] });

    const server = new OracleMCPServer({ toolGroups, unifiedRuntime: runtime, installSignalHandlers: false });
    try {
      const response = await callMcpTool(server, 'oracle_dig', {
        subject: 'oracle_dig phase4 wiring',
        relation: 'registers',
        object: 'callable MCP tools',
        dug_by: '[m5:arra-oracle-v3]',
        as_of_ts: Date.parse('2026-07-12T00:00:00.000Z'),
        as_of_commit: 'phase4-test',
        confidence: 'high',
        topic: 'phase4',
        evidence: [{ kind: 'web', web: { url: 'https://github.com/Soul-Brews-Studio/arra-oracle-v3/issues/2781', fetched_at: '2026-07-12T00:00:00.000Z' } }],
        trace: {
          query: 'oracle_dig phase4 wiring',
          project: 'Soul-Brews-Studio/arra-oracle-v3',
          foundFiles: [{ path: 'github.com/Soul-Brews-Studio/arra-oracle-v3/blob/alpha/src/plugins/oracle-dig/index.ts#L1', type: 'other', confidence: 'high' }],
          foundCommits: [{ hash: 'abc123', shortHash: 'abc123', date: '2026-07-12', message: 'test commit' }],
          foundIssues: [{ number: 2781, title: 'Phase 4 wiring', state: 'open', url: 'https://github.com/Soul-Brews-Studio/arra-oracle-v3/issues/2781' }],
        },
        sessions: { projectsDir: sessionRoot(), limit: 1 },
      });
      const payload = JSON.parse(response.content[0].text);
      expect(response.isError).not.toBe(true);
      expect(payload.finding.subject).toBe('oracle_dig phase4 wiring');
      expect(payload.evidenceCount).toBe(5);
    } finally {
      await server.cleanup();
    }

    const findings = db.select().from(oracleFindings).all();
    const evidence = db.select().from(oracleFindingEvidence).all();
    expect(findings).toHaveLength(1);
    expect(evidence).toHaveLength(5);
    expect(evidence.map((row) => row.kind).sort()).toEqual(['github', 'github', 'github', 'session', 'web']);

    const routeApp = new Elysia();
    for (const route of runtime.routes) routeApp.use(route as any);
    const apiResponse = await routeApp.handle(new Request('http://local/api/plugins/oracle-dig?topic=phase4'));
    expect(apiResponse.status).toBe(200);
    expect(await apiResponse.json()).toMatchObject({ ok: true, total: 1 });
  });
});
