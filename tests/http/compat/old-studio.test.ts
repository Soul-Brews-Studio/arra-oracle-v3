import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { UnifiedRuntime } from '../../../src/plugins/unified-loader.ts';

const scratch = mkdtempSync(join(tmpdir(), 'arra-old-studio-compat-'));
const originalDataDir = process.env.ORACLE_DATA_DIR;
const originalDbPath = process.env.ORACLE_DB_PATH;
const originalEmbedder = process.env.ORACLE_EMBEDDER;
const originalToken = process.env.ARRA_API_TOKEN;
process.env.ORACLE_DATA_DIR = scratch;
process.env.ORACLE_DB_PATH = join(scratch, 'oracle.db');
process.env.ORACLE_EMBEDDER = 'none';
delete process.env.ARRA_API_TOKEN;

const { createApp } = await import('../../../src/server.ts');
const { closeDb } = await import('../../../src/db/index.ts');
const { createApiVersionedFetch } = await import('../../../src/middleware/api-version.ts');

function runtime(): UnifiedRuntime {
  return {
    pluginCount: 0, routes: [], mcpTools: [], menu: [], cliSubcommands: [], servers: [],
    callMcpTool: async () => ({}), pluginStatuses: () => [], pluginRegistry: () => [],
    init: async () => {}, reload: async () => {}, stop: async () => {},
  };
}

const app = createApp({ unifiedPlugins: runtime(), dataDir: scratch, vectorUrl: '' });
const versionedFetch = createApiVersionedFetch((request) => app.handle(request));

async function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: Timer | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), 750);
  });
  try { return await Promise.race([work, timeout]); }
  finally { if (timer) clearTimeout(timer); }
}

async function json(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const res = await withTimeout(app.handle(new Request(`http://studio.test${path}`, { ...init, headers })), path);
  const body = await withTimeout(res.json(), `${path} json`);
  return { res, body };
}

async function hostedJson(path: string, origin: string) {
  const res = await withTimeout(versionedFetch(new Request(`http://localhost:47778${path}`, {
    headers: { accept: 'application/json', origin },
  })), path);
  const body = await withTimeout(res.json(), `${path} json`);
  return { res, body };
}

describe('old Studio backend compatibility endpoints', () => {
  const oldStudioGets = [
    '/api/health', '/api/stats', '/api/graph', '/api/menu', '/api/map3d',
    '/api/sessions', '/api/capture', '/api/send', '/api/reflect',
  ];

  for (const path of oldStudioGets) {
    test(`GET ${path} returns timely JSON`, async () => {
      const { res, body } = await json(path);
      expect(res.status).toBeGreaterThanOrEqual(200);
      expect(res.status).toBeLessThan(500);
      expect(res.headers.get('content-type') || '').toContain('application/json');
      expect(body && typeof body).toBe('object');
    });
  }

  test('new stubbed compat endpoints keep old POST calls JSON-safe', async () => {
    for (const path of ['/api/capture', '/api/send']) {
      const { res, body } = await json(path, { method: 'POST', body: JSON.stringify({ text: 'hello' }) });
      expect(res.status).toBe(200);
      expect(body).toMatchObject({ success: true, accepted: true, compat: 'old-studio' });
    }
  });

  test('GET /api/sessions has the legacy sessions array shape', async () => {
    const { body } = await json('/api/sessions') as { body: { sessions: unknown[]; total: number } };
    expect(Array.isArray(body.sessions)).toBe(true);
    expect(body.total).toBe(body.sessions.length);
  });

  test('hosted Feed page list request returns top-level document feed JSON', async () => {
    for (const origin of ['https://studio.buildwithoracle.com', 'https://feed.buildwithoracle.com']) {
      const { res, body } = await hostedJson('/api/list?limit=50&offset=0&group=false', origin) as {
        res: Response;
        body: { success?: boolean; results?: unknown[]; total?: number };
      };
      expect(res.status).toBe(200);
      expect(res.headers.get('location')).toBeNull();
      expect(res.headers.get('x-api-version')).toBe('v1');
      expect(res.headers.get('access-control-allow-origin')).toBe(origin);
      expect(body.success).toBe(true);
      expect(Array.isArray(body.results)).toBe(true);
      expect(typeof body.total).toBe('number');
    }
  });
});

afterAll(() => {
  closeDb();
  if (originalDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = originalDataDir;
  if (originalDbPath === undefined) delete process.env.ORACLE_DB_PATH;
  else process.env.ORACLE_DB_PATH = originalDbPath;
  if (originalEmbedder === undefined) delete process.env.ORACLE_EMBEDDER;
  else process.env.ORACLE_EMBEDDER = originalEmbedder;
  if (originalToken === undefined) delete process.env.ARRA_API_TOKEN;
  else process.env.ARRA_API_TOKEN = originalToken;
  rmSync(scratch, { recursive: true, force: true });
});
