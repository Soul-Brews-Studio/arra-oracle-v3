import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { startSmokeServer, writePsiMemory, type SmokeServer } from '../smoke/_helpers.ts';

let server: SmokeServer | null = null;
const token = `fullstackphoenix${Date.now()}`;

type JsonRecord = Record<string, unknown>;

beforeAll(async () => {
  server = await startSmokeServer({ name: 'full-stack-scenarios' });
  writePsiMemory(server.repoRoot, `---
tags: [full-stack, phoenix]
---

${token} proves the spawned server can index a ψ learning, recall it through
search and ask, then export the same content as an artifact.
`);
}, 30_000);

afterAll(async () => {
  await server?.stop();
});

function expectRecord(value: unknown): asserts value is JsonRecord {
  expect(typeof value).toBe('object');
  expect(value).not.toBeNull();
  expect(Array.isArray(value)).toBe(false);
}

function expectJson(response: Response, status = 200): void {
  expect(response.status).toBe(status);
  expect(response.headers.get('content-type') ?? '').toContain('application/json');
  expect(response.headers.get('x-api-version')).toBe('v1');
}

async function fetchJson(path: string, init: RequestInit = {}) {
  expect(server).not.toBeNull();
  const headers = new Headers(init.headers);
  headers.set('accept', headers.get('accept') ?? 'application/json');
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(`${server!.baseUrl}${path}`, { ...init, headers });
  const body = await response.json() as unknown;
  expectRecord(body);
  return { response, body };
}

function postJson(path: string, body: unknown) {
  return fetchJson(path, { method: 'POST', body: JSON.stringify(body) });
}

function arrayBody(body: JsonRecord, key: string): JsonRecord[] {
  expect(Array.isArray(body[key])).toBe(true);
  return body[key] as JsonRecord[];
}

async function waitForExportJob(id: string): Promise<JsonRecord> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const status = await fetchJson(`/api/v1/export/${id}`);
    expectJson(status.response);
    expectRecord(status.body.job);
    const job = status.body.job;
    if (job.status === 'completed') return job;
    if (job.status === 'failed') throw new Error(`export failed: ${String(job.error)}`);
    await Bun.sleep(25);
  }
  throw new Error(`export job did not complete: ${id}`);
}

async function downloadJson(path: string): Promise<{ response: Response; body: JsonRecord }> {
  expect(server).not.toBeNull();
  const response = await fetch(`${server!.baseUrl}${path}`, { headers: { accept: 'application/json' } });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type') ?? '').toContain('application/json');
  const body = await response.json() as unknown;
  expectRecord(body);
  return { response, body };
}

describe('full-stack HTTP scenarios', () => {
  test('boots server, indexes ψ memory, searches, asks, and exports artifacts', async () => {
    expect(server).not.toBeNull();

    const health = await fetchJson('/api/v1/health');
    expectJson(health.response);
    expect(health.body.status).toBe('ok');

    const scan = await postJson('/api/v1/indexer/scan', { sourcePath: server!.repoRoot, types: ['learning'] });
    expectJson(scan.response);
    expect(scan.body.total).toBe(1);
    expect(scan.body.recommendedAction).toBe('POST /api/indexer/reindex');

    const reindex = await postJson('/api/v1/indexer/reindex', { repoRoot: server!.repoRoot });
    expectJson(reindex.response);
    expect(reindex.body).toMatchObject({ ok: true, status: 'complete', repoRoot: server!.repoRoot });

    const search = await fetchJson(`/api/v1/search?q=${token}&mode=fts&limit=3`);
    expectJson(search.response);
    expect(search.body.total).toBeGreaterThanOrEqual(1);
    expect(arrayBody(search.body, 'results')).toContainEqual(expect.objectContaining({
      source_file: 'ψ/memory/learnings/smoke-memory.md',
      content: expect.stringContaining(token),
    }));

    const ask = await postJson('/api/v1/ask', { q: token, llm: false, limit: 3 });
    expectJson(ask.response);
    expect(ask.body).toMatchObject({ mode: 'extractive', noEvidence: false });
    expect(String(ask.body.answer)).toContain(token);
    expect(arrayBody(ask.body, 'sources')[0]).toMatchObject({ sourceFile: 'ψ/memory/learnings/smoke-memory.md' });

    const createdExport = await postJson('/api/v1/export', { format: 'json', source: 'vault' });
    expectJson(createdExport.response, 202);
    expectRecord(createdExport.body.job);
    const jobId = String(createdExport.body.job.id);
    const completedExport = await waitForExportJob(jobId);
    expect(completedExport).toMatchObject({ status: 'completed', progress: 100 });
    expect(typeof completedExport.downloadUrl).toBe('string');

    const download = await downloadJson(String(completedExport.downloadUrl));
    expect(download.response.headers.get('x-export-job-id')).toBe(jobId);
    expectRecord(download.body.tables);
    expect(arrayBody(download.body.tables, 'oracleDocuments')).toContainEqual(expect.objectContaining({
      sourceFile: 'ψ/memory/learnings/smoke-memory.md',
    }));

    const exportedDocs = await fetchJson('/api/v1/export/documents/oracle_documents');
    expectJson(exportedDocs.response);
    expect(exportedDocs.body.count).toBe(1);
    expect(arrayBody(exportedDocs.body, 'documents')[0]).toMatchObject({
      source: 'ψ/memory/learnings/smoke-memory.md',
      content: expect.stringContaining(token),
    });
  }, 45_000);
});
