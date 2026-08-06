import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  fetchJson,
  isRecord,
  jsonInit,
  setContractSetting,
  startHttpContractServer,
  writeFakeGhq,
  type ContractServer,
} from './rtk.ts';

const runId = `${process.pid}-${Date.now()}`;
const api = (path: string) => `/api/v1${path}`;
let server: ContractServer | null = null;

type Spec = { path: string; init?: RequestInit; status?: number | number[]; keys?: string[] };
type ClusterCase = { cluster: string; happy: Spec; error: Spec; errorMessage?: RegExp };

beforeAll(async () => {
  server = await startHttpContractServer({ name: 'http-contract-clusters', withPlugin: true, prepareEnv: writeFakeGhq });
  setContractSetting(server, 'vault_repo', 'contract/vault');
}, 25_000);

afterAll(async () => {
  await server?.stop();
});

const cases: ClusterCase[] = [
  { cluster: 'gateway', happy: { path: '/api/gateway/status', keys: ['enabled'] }, error: { path: '/api/gateway/missing', status: 404 } },
  { cluster: 'auth', happy: { path: api('/auth/status'), keys: ['authenticated', 'authEnabled'] }, error: { path: api('/auth/login'), init: jsonInit('POST', {}), status: 400 }, errorMessage: /Password required/ },
  { cluster: 'settings', happy: { path: api('/settings'), keys: ['authEnabled', 'hasPassword'] }, error: { path: api('/settings'), init: jsonInit('POST', { authEnabled: true }), status: 400 }, errorMessage: /password/i },
  { cluster: 'feed', happy: { path: api('/feed'), keys: ['events', 'total'] }, error: { path: api('/feed'), init: jsonInit('POST', {}), status: 400 }, errorMessage: /oracle, event/ },
  { cluster: 'health', happy: { path: api('/health'), keys: ['status', 'server'] }, error: { path: api('/health/missing'), status: 404 } },
  { cluster: 'dashboard', happy: { path: api('/dashboard'), keys: ['documents', 'concepts'] }, error: { path: api('/dashboard/bogus'), status: 404 } },
  { cluster: 'search', happy: { path: api('/search?q=oracle'), keys: ['results', 'total'] }, error: { path: api('/search'), status: 400 }, errorMessage: /Missing query/ },
  { cluster: 'ask', happy: { path: api('/ask'), init: jsonInit('POST', { q: 'oracle', llm: false }), keys: ['query', 'answer', 'sources'] }, error: { path: api('/ask'), init: jsonInit('POST', { q: '' }), status: 400 }, errorMessage: /empty/ },
  { cluster: 'vector', happy: { path: api('/vector/config'), keys: ['enabled', 'state'] }, error: { path: api('/vector/export?format=bogus'), status: 400 }, errorMessage: /Invalid format/ },
  { cluster: 'concepts', happy: { path: api('/concepts'), keys: ['concepts', 'total_unique'] }, error: { path: api('/concepts/missing'), status: 404 } },
  { cluster: 'knowledge', happy: { path: api('/learn'), keys: ['items', 'total'] }, error: { path: api('/learn'), init: jsonInit('POST', {}), status: 400 }, errorMessage: /pattern/ },
  { cluster: 'research', happy: { path: api('/research/note'), init: jsonInit('POST', { title: 'Contract note', question: 'Q', recommendation: 'R' }), keys: ['success', 'id'] }, error: { path: api('/research/note'), init: jsonInit('POST', {}), status: 400 }, errorMessage: /title/ },
  { cluster: 'verify', happy: { path: api('/verify?check=true&type=all'), keys: ['counts', 'missing'] }, error: { path: api('/verify'), init: jsonInit('POST', { check: 'yes' }), status: 422 }, errorMessage: /Unprocessable/ },
  { cluster: 'supersede', happy: { path: api('/supersede'), keys: ['supersessions', 'total'] }, error: { path: api('/supersede'), init: jsonInit('POST', {}), status: 400 }, errorMessage: /old_path/ },
  { cluster: 'forum', happy: { path: api('/threads'), keys: ['threads', 'total'] }, error: { path: api('/thread/not-a-number'), status: 400 }, errorMessage: /Invalid thread/ },
  { cluster: 'traces', happy: { path: api('/traces'), keys: ['traces', 'total'] }, error: { path: api('/traces/missing'), status: 404 }, errorMessage: /Trace not found/ },
  { cluster: 'schedule', happy: { path: api('/schedule'), keys: ['events', 'total'] }, error: { path: api('/schedule/bad'), init: jsonInit('PATCH', { event: 'bad id' }), status: 400 }, errorMessage: /Invalid schedule id/ },
  { cluster: 'files', happy: { path: api('/graph'), keys: ['nodes', 'links'] }, error: { path: api('/file'), status: 400 }, errorMessage: /Missing path/ },
  { cluster: 'plugins', happy: { path: api('/plugins'), keys: ['plugins', 'count'] }, error: { path: api('/plugins/missing-nope'), status: 404 }, errorMessage: /Plugin not found/ },
  { cluster: 'sessions', happy: { path: api(`/session/session-${runId}/summary`), init: jsonInit('POST', { summary: 'contract summary', oracle: 'test' }), status: 201, keys: ['learning_id', 'source_file'] }, error: { path: api(`/session/bad-${runId}/summary`), init: jsonInit('POST', { summary: '' }), status: 400 }, errorMessage: /summary/ },
  { cluster: 'vault', happy: { path: api('/vault/sync'), init: jsonInit('POST', { dryRun: true }), keys: ['ok', 'migrate'] }, error: { path: api('/vault/sync'), init: jsonInit('POST', { dryRun: 'yes' }), status: 422 }, errorMessage: /Unprocessable/ },
  { cluster: 'metrics', happy: { path: api('/metrics'), keys: ['uptime', 'requestCount'] }, error: { path: api('/metrics/missing'), status: 404 } },
  { cluster: 'export', happy: { path: api('/export/collections'), keys: ['collections', 'formats'] }, error: { path: api('/export/progress'), status: 400 }, errorMessage: /jobId/ },
  { cluster: 'memory', happy: { path: api('/memory/recall'), keys: ['query', 'items'] }, error: { path: api('/memory/search'), status: 400 }, errorMessage: /Missing query/ },
  { cluster: 'canvas', happy: { path: api('/canvas/plugins'), keys: ['plugins', 'count'] }, error: { path: api('/canvas/plugins/missing'), status: 404 }, errorMessage: /canvas plugin not found/ },
  { cluster: 'tenants', happy: { path: api('/tenants'), keys: ['tenants', 'count'] }, error: { path: api('/tenants'), init: jsonInit('POST', { id: 'bad space' }), status: 400 }, errorMessage: /Invalid tenant id/ },
  { cluster: 'watcher', happy: { path: api('/watcher/status'), keys: ['running', 'watchedDirs'] }, error: { path: api('/watcher/nope'), status: 404 } },
  { cluster: 'indexer', happy: { path: api('/indexer/config'), keys: ['adapters', 'models'] }, error: { path: api('/indexer/missing'), status: 404 } },
  { cluster: 'mcp', happy: { path: api('/mcp/tools'), keys: ['tools', 'total'] }, error: { path: api('/mcp/missing'), status: 404 } },
  { cluster: 'menu', happy: { path: api('/menu'), keys: ['items'] }, error: { path: api('/menu/items/not-number'), init: jsonInit('PATCH', {}), status: 400 }, errorMessage: /invalid id/ },
];

function expectStatus(response: Response, expected: number | number[] | undefined, fallback: number): void {
  const statuses = Array.isArray(expected) ? expected : [expected ?? fallback];
  expect(statuses).toContain(response.status);
}

function expectRecordBody(body: unknown): asserts body is Record<string, unknown> {
  expect(isRecord(body)).toBe(true);
}

function expectKeys(body: Record<string, unknown>, keys: string[] = []): void {
  for (const key of keys) expect(body).toHaveProperty(key);
}

async function exercise(spec: Spec) {
  expect(server).not.toBeNull();
  const result = await fetchJson(server!, spec.path, spec.init);
  expect(result.response.headers.get('content-type') ?? '').toContain('application/json');
  expect(result.response.headers.get('x-api-version')).toBe('v1');
  expectRecordBody(result.body);
  return result;
}

describe('spawned Elysia HTTP cluster contract', () => {
  test('publishes OpenAPI JSON and root metadata outside the versioned API', async () => {
    expect(server).not.toBeNull();
    const docs = await fetchJson(server!, '/api/docs/json');
    expect(docs.response.status).toBe(200);
    expectRecordBody(docs.body);
    expect(docs.body.paths).toHaveProperty('/api/health');

    const root = await fetchJson(server!, '/');
    expect(root.response.status).toBe(200);
    expectRecordBody(root.body);
    expect(root.body).toMatchObject({ status: 'ok', api: '/api/v1' });
  });

  for (const contract of cases) {
    test(`${contract.cluster} happy path returns versioned JSON contract`, async () => {
      const { response, body } = await exercise(contract.happy);
      expectStatus(response, contract.happy.status, 200);
      expect(response.ok).toBe(true);
      expectKeys(body, contract.happy.keys);
    });

    test(`${contract.cluster} error path returns JSON error contract`, async () => {
      const { response, body } = await exercise(contract.error);
      expectStatus(response, contract.error.status, 400);
      expect(response.ok).toBe(false);
      expect(typeof body.error).toBe('string');
      if (contract.errorMessage) expect(String(body.error)).toMatch(contract.errorMessage);
    });
  }
});
