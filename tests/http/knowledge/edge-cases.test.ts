import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tempData = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-knowledge-edge-db-'));
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-knowledge-edge-root-'));
const previousData = process.env.ORACLE_DATA_DIR;
const previousDb = process.env.ORACLE_DB_PATH;
const previousRoot = process.env.ORACLE_REPO_ROOT;
const stamp = `${Date.now()}${Math.random().toString(16).slice(2)}`;
const tenantId = `tenant-edge-${stamp}`;

let knowledgeRoutes: { handle: (request: Request) => Response | Promise<Response> };
let createTenantFetch: typeof import('../../../src/middleware/tenant.ts').createTenantFetch;
let tenantHeader: string;
let closeDb: () => void;

beforeAll(async () => {
  process.env.ORACLE_DATA_DIR = tempData;
  process.env.ORACLE_DB_PATH = path.join(tempData, 'oracle.db');
  process.env.ORACLE_REPO_ROOT = tempRoot;
  const dbModule = await import('../../../src/db/index.ts');
  dbModule.resetDefaultDatabaseForTests(process.env.ORACLE_DB_PATH);
  closeDb = dbModule.closeDb;
  const tenant = await import('../../../src/middleware/tenant.ts');
  createTenantFetch = tenant.createTenantFetch;
  tenantHeader = tenant.TENANT_HEADER;
  ({ knowledgeRoutes } = await import('../../../src/routes/knowledge/index.ts'));
});

function requestKnowledge(pathname: string, init: RequestInit = {}) {
  return createTenantFetch((request) => knowledgeRoutes.handle(request))(new Request(`http://local${pathname}`, {
    ...init,
    headers: { 'content-type': 'application/json', [tenantHeader]: tenantId, ...(init.headers ?? {}) },
  }));
}

afterAll(() => {
  closeDb?.();
  if (previousData === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = previousData;
  if (previousDb === undefined) delete process.env.ORACLE_DB_PATH;
  else process.env.ORACLE_DB_PATH = previousDb;
  if (previousRoot === undefined) delete process.env.ORACLE_REPO_ROOT;
  else process.env.ORACLE_REPO_ROOT = previousRoot;
  fs.rmSync(tempData, { recursive: true, force: true });
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('knowledge route edge cases', () => {
  test('POST /api/handoff sanitizes slugs into the tenant handoff directory', async () => {
    const res = await requestKnowledge('/api/handoff', {
      method: 'POST',
      body: JSON.stringify({ content: `tenant handoff ${stamp}`, slug: '../../escape me' }),
    });
    const body = await res.json() as { file: string; success: boolean };

    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.file).toStartWith(`ψ/tenants/${tenantId}/inbox/handoff/`);
    expect(body.file).not.toContain('..');
    expect(path.basename(body.file)).toContain('escape-me');
  });

  test('POST /api/handoff rejects blank content', async () => {
    const res = await requestKnowledge('/api/handoff', {
      method: 'POST',
      body: JSON.stringify({ content: '   ', slug: 'blank' }),
    });
    const body = await res.json() as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toContain('content');
  });

  test('GET /api/inbox clamps pagination and skips non-file markdown entries', async () => {
    const handoffDir = path.join(tempRoot, 'ψ', 'tenants', tenantId, 'inbox', 'handoff');
    fs.mkdirSync(path.join(handoffDir, 'not-a-file.md'), { recursive: true });

    const res = await requestKnowledge('/api/inbox?type=handoff&limit=NaN&offset=-50');
    const body = await res.json() as { files: Array<{ filename: string }>; total: number; limit: number; offset: number };

    expect(res.status).toBe(200);
    expect(body.limit).toBe(10);
    expect(body.offset).toBe(0);
    expect(body.files.some((file) => file.filename === 'not-a-file.md')).toBe(false);
  });
});
