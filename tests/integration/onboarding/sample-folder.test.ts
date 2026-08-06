import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { startSmokeServer, writePsiMemory, type SmokeServer } from '../../smoke/_helpers.ts';

let server: SmokeServer | null = null;
const token = `onboardinghelios${Date.now()}`;

type JsonRecord = Record<string, unknown>;

beforeAll(async () => {
  server = await startSmokeServer({ name: 'onboarding-sample-folder' });
  writePsiMemory(server.repoRoot, `---
tags: [onboarding, helios]
---

${token} proves the onboarding path can mine a sample ψ folder and return the
newly ingested learning through FTS search.
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

function resultRecords(body: JsonRecord): JsonRecord[] {
  expect(Array.isArray(body.results)).toBe(true);
  return body.results as JsonRecord[];
}

describe('onboarding sample-folder flow', () => {
  test('boots server, mines a sample ψ folder, and searches ingested content', async () => {
    expect(server).not.toBeNull();

    const health = await fetchJson('/api/v1/health');
    expectJson(health.response);
    expect(health.body.status).toBe('ok');

    const scan = await postJson('/api/v1/indexer/scan', {
      sourcePath: server!.repoRoot,
      types: ['learning'],
    });
    expectJson(scan.response);
    expect(scan.body).toMatchObject({
      total: 1,
      psiDetected: true,
      canIndexFts: true,
      recommendedAction: 'POST /api/indexer/reindex',
    });

    const reindex = await postJson('/api/v1/indexer/reindex', { repoRoot: server!.repoRoot });
    expectJson(reindex.response);
    expect(reindex.body).toMatchObject({ ok: true, status: 'complete', repoRoot: server!.repoRoot });

    const search = await fetchJson(`/api/v1/search?q=${token}&mode=fts&limit=5`);
    expectJson(search.response);
    expect(search.body.total).toBeGreaterThanOrEqual(1);
    expect(resultRecords(search.body)).toContainEqual(expect.objectContaining({
      source_file: 'ψ/memory/learnings/smoke-memory.md',
      content: expect.stringContaining(token),
    }));
  }, 45_000);
});
