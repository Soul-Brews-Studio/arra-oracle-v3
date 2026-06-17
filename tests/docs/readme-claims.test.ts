import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import pkg from '../../package.json' with { type: 'json' };

const repoRoot = process.cwd();
const readme = readFileSync('README.md', 'utf8');
const apiDoc = readFileSync('docs/API.md', 'utf8');
let scratch = '';
let closeDb: (() => void) | undefined;
let fetchClaim: ((request: Request) => Promise<Response> | Response) | undefined;
let routeKeys: Set<string> = new Set();
let routeCount = 0;
let apiRouteCount = 0;
let coreMcpToolNames: string[] = [];

type RuntimeClaim = {
  label: string;
  method?: string;
  path: string;
  body?: unknown;
  keys: string[];
  statuses?: number[];
};

const runtimeClaims: RuntimeClaim[] = [
  { label: 'README health check', path: '/api/health', keys: ['status', 'server'] },
  { label: 'README search example', path: '/api/v1/search?q=oracle&mode=fts&limit=1', keys: ['results', 'total'] },
  { label: 'README learn endpoint', method: 'POST', path: '/api/v1/learn', body: { pattern: 'README claim test learning', concepts: ['docs'] }, keys: ['success', 'id'] },
  { label: 'README vector config', path: '/api/v1/vector/config', keys: ['enabled', 'state'] },
  { label: 'README vector status', path: '/api/v1/vector/status', keys: ['status'], statuses: [200, 503] },
  { label: 'README plugins list', path: '/api/v1/plugins', keys: ['plugins', 'count'] },
  { label: 'README menu list', path: '/api/v1/menu', keys: ['items'] },
  { label: 'README canvas plugin registry', path: '/api/v1/canvas/plugins', keys: ['plugins', 'count'] },
  { label: 'CLI guide ask example', method: 'POST', path: '/api/v1/ask', body: { q: 'What does the Oracle know?', llm: false, limit: 1 }, keys: ['query', 'answer', 'sources'] },
  { label: 'API guide MCP tools', path: '/api/v1/mcp/tools', keys: ['tools', 'total'] },
];

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'arra-readme-claims-'));
  const dataDir = join(scratch, 'data');
  const repo = join(scratch, 'repo');
  mkdirSync(join(repo, 'ψ', 'memory', 'learnings'), { recursive: true });
  Object.assign(process.env, {
    ARRA_PLUGIN_HOT_RELOAD: '0',
    NODE_ENV: 'test',
    ORACLE_DATA_DIR: dataDir,
    ORACLE_DB_PATH: join(dataDir, 'oracle.db'),
    ORACLE_EMBEDDER: 'none',
    ORACLE_FILE_WATCHER: '0',
    ORACLE_GATEWAY_HOT_RELOAD: '0',
    ORACLE_REPO_ROOT: repo,
    ORACLE_TOOL_GROUPS_HOT_RELOAD: '0',
    ORACLE_VECTOR_HEALTH_TIMEOUT: '1000',
    VECTOR_URL: '',
  });

  const db = await import('../../src/db/index.ts');
  db.resetDefaultDatabaseForTests(process.env.ORACLE_DB_PATH);
  closeDb = db.closeDb;
  const { createApp } = await import('../../src/server.ts');
  const { createApiVersionedFetch } = await import('../../src/middleware/api-version.ts');
  const { createDbContextFetch } = await import('../../src/middleware/db-context.ts');
  const { createTenantFetch } = await import('../../src/middleware/tenant.ts');
  const { mcpTools } = await import('../../src/tools/mcp-manifest.ts');
  coreMcpToolNames = mcpTools.map((tool) => tool.name);

  const runtime = emptyRuntime();
  const app = createApp({ unifiedPlugins: runtime, dataDir, vectorUrl: '' });
  routeCount = app.routes.length;
  apiRouteCount = app.routes.filter((route) => route.path.startsWith('/api')).length;
  routeKeys = new Set(app.routes.map((route) => routeKey(route.method, route.path)));
  fetchClaim = createApiVersionedFetch(createTenantFetch(createDbContextFetch((request) => app.fetch(request))));
});

afterAll(() => {
  closeDb?.();
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

describe('README/docs advertised claims', () => {
  test('README project-structure files and directories exist', () => {
    const missing = advertisedReadmePaths().filter((path) => !existsSync(resolve(repoRoot, path)));
    expect(missing).toEqual([]);
  });

  test('CLI guide useful bun scripts exist in package.json', () => {
    const missing = advertisedScripts().filter((script) => !(script in pkg.scripts));
    expect(missing).toEqual([]);
  });

  test('API route count claim matches the base Elysia app', () => {
    const match = apiDoc.match(/base `createApp\(\)` .*? exposes (\d+) routes, (\d+) under `\/api`/i);
    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBe(routeCount);
    expect(Number(match?.[2])).toBe(apiRouteCount);
  });

  test('HTTP reference table paths exist in the current route table', () => {
    const missing = advertisedHttpReferenceRoutes().filter((route) => !routeKeys.has(routeKey(route.method, route.path)));
    expect(missing).toEqual([]);
  });

  for (const claim of runtimeClaims) {
    test(`${claim.label} responds`, async () => {
      expect(fetchClaim).toBeDefined();
      const response = await fetchClaim!(jsonRequest(claim));
      const body = await response.json() as Record<string, unknown>;
      const allowed = claim.statuses ?? [200];
      expect(allowed, `${claim.method ?? 'GET'} ${claim.path}: ${JSON.stringify(body)}`).toContain(response.status);
      for (const key of claim.keys) expect(body).toHaveProperty(key);
    });
  }

  test('advertised MCP core tool count and names match the manifest and HTTP browser', async () => {
    expect(coreMcpToolNames).toHaveLength(28);
    expect(coreMcpToolNames).toContain('oracle_search');
    expect(coreMcpToolNames).toContain('oracle_trace_distill');

    const response = await fetchClaim!(new Request('http://local/api/v1/mcp/tools'));
    const body = await response.json() as { tools: Array<{ name: string; source: string }>; total: number };
    const coreNames = body.tools.filter((tool) => tool.source === 'core').map((tool) => tool.name);
    expect(response.ok).toBe(true);
    expect(body.total).toBeGreaterThanOrEqual(28);
    expect(coreNames).toEqual(coreMcpToolNames);
  });
});

function advertisedReadmePaths(): string[] {
  const block = readme.match(/## Project structure[\s\S]*?```text\n([\s\S]*?)```/)?.[1] ?? '';
  return block.split('\n')
    .map((line) => line.trim().split(/\s+/)[0])
    .filter((path) => path && !path.includes('*'))
    .map((path) => path.replace(/\/$/, ''));
}

function advertisedScripts(): string[] {
  const guide = readFileSync('docs/CLI-GUIDE.md', 'utf8');
  return [...guide.matchAll(/\|\s*`bun run ([^`\s]+)`/g)].map((match) => match[1]).sort();
}

function advertisedHttpReferenceRoutes(): Array<{ method: string; path: string }> {
  const ref = readFileSync('docs/http-api-reference.md', 'utf8');
  const rows: Array<{ method: string; path: string }> = [];
  for (const line of ref.split('\n')) {
    if (line.startsWith('## Federation mesh')) break;
    const match = line.match(/^\|\s*([^|`]+?)\s*\|\s*`([^`]+)`/);
    if (!match || !match[2].startsWith('/api/')) continue;
    const methods = match[1].split('/').map((method) => method.trim()).filter(Boolean);
    for (const method of methods) rows.push({ method, path: match[2] });
  }
  return rows;
}

function routeKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${normalizeRoutePath(path)}`;
}

function normalizeRoutePath(path: string): string {
  const unversioned = path.replace(/^\/api\/v1(?=\/|$)/, '/api');
  return unversioned === '/api' ? unversioned : unversioned.replace(/\/$/, '');
}

function jsonRequest(claim: RuntimeClaim): Request {
  const headers = new Headers({ accept: 'application/json' });
  let body: string | undefined;
  if (claim.body !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(claim.body);
  }
  return new Request(`http://local${claim.path}`, { method: claim.method ?? 'GET', headers, body });
}

function emptyRuntime() {
  return {
    init: async () => {},
    stop: async () => {},
    reload: async () => {},
    pluginCount: 0,
    pluginStatuses: [],
    mcpTools: [],
    menu: [],
    routes: [],
    servers: [],
    pluginRegistry: () => [],
  } as any;
}
