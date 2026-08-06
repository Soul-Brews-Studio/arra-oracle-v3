import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chunkText } from '../../src/indexer/chunker.ts';
import { runSmokeCli, startSmokeServer, type SmokeServer } from '../smoke/_helpers.ts';

let server: SmokeServer | null = null;
const searchToken = `onboardingsearch${Date.now()}`;
const chunkToken = `chunkmetadata${Date.now()}`;

type JsonRecord = Record<string, unknown>;
type StoredRow = {
  id: string;
  source_file: string;
  project: string | null;
  concepts: string;
  content: string;
};

beforeAll(async () => {
  server = await startSmokeServer({ name: 'onboarding-e2e' });
}, 30_000);

afterAll(async () => {
  await server?.stop();
});

describe('P0 onboarding E2E', () => {
  test('spawns server, mines a folder, then searches derived chunked content', async () => {
    const app = activeServer();
    const system = await fetchJson('/api/v1/settings/system');
    expectJson(system.response);
    expect(system.body.storage).toMatchObject({ dbPath: app.dbPath, repoRoot: app.repoRoot });
    expect(system.body.embedder).toMatchObject({ source: 'defaults', backend: 'none' });
    const primary = collections(system.body).find((item) => item.key === 'bge-m3');
    expect(primary).toMatchObject({ provider: 'ollama', primary: true });
    expect(['sqlite-vec', 'lancedb']).toContain(primary?.adapter);

    const notes = join(app.root, 'github.com', 'Soul-Brews-Studio', 'onboarding-e2e', 'knowledge');
    const note = join(notes, 'ops', 'p0-onboarding.md');
    mkdirSync(join(notes, 'ops'), { recursive: true });
    const content = onboardingNote();
    const chunks = chunkText(content);
    expect(chunks.map(({ chunk_index, line_start, line_end }) => ({ chunk_index, line_start, line_end }))).toEqual([
      { chunk_index: 0, line_start: 1, line_end: 3 },
      { chunk_index: 1, line_start: 5, line_end: 7 },
      { chunk_index: 2, line_start: 9, line_end: 11 },
    ]);
    writeFileSync(note, content, 'utf8');

    const mined = await runSmokeCli(app, ['mine', notes]);
    expect(mined).toMatchObject({ code: 0, stderr: '' });
    expect(mined.stdout).toContain(`Mined ${chunks.length} documents from 1 file`);

    const stored = minedRows(app.dbPath);
    expect(stored).toHaveLength(chunks.length);
    expect(stored.map((row) => row.id)).toEqual(chunks.map((chunk) => expect.stringContaining(`__chunk_${chunk.chunk_index}`)));
    expect(stored.every((row) => row.source_file === 'mine/knowledge/ops/p0-onboarding.md')).toBe(true);
    expect(stored.every((row) => row.project === 'github.com/soul-brews-studio/onboarding-e2e')).toBe(true);

    const firstConcepts = JSON.parse(stored[0].concepts) as string[];
    expect(firstConcepts).toEqual(expect.arrayContaining(['github.com/soul-brews-studio/onboarding-e2e', 'ops', 'onboarding', 'config']));
    expect(stored.find((row) => row.content.includes(chunkToken))?.id).toContain('__chunk_1');

    const search = await fetchJson(`/api/v1/search?q=${chunkToken}&mode=fts&limit=5`);
    expectJson(search.response);
    expect(search.body.total).toBeGreaterThanOrEqual(1);
    expect(results(search.body)).toContainEqual(expect.objectContaining({
      id: expect.stringContaining('__chunk_1'),
      source_file: 'mine/knowledge/ops/p0-onboarding.md',
      project: 'github.com/soul-brews-studio/onboarding-e2e',
      content: expect.stringContaining(chunkToken),
    }));

    const recall = await fetchJson(`/api/v1/search?q=${searchToken}&mode=fts&limit=5`);
    expectJson(recall.response);
    expect(results(recall.body)).toContainEqual(expect.objectContaining({ content: expect.stringContaining(searchToken) }));
  }, 45_000);
});

function activeServer(): SmokeServer {
  expect(server).not.toBeNull();
  return server!;
}

function onboardingNote(): string {
  const para = (label: string, token: string) => [
    `## ${label}`,
    `${token} verifies the P0 onboarding path with memory, config, default safety, and search recall.`,
    'onboarding '.repeat(38),
  ].join('\n');
  return [
    para('Default safe config', searchToken),
    para('Chunk metadata probe', chunkToken),
    para('Auto derive concepts', 'autoderiveconcept'),
  ].join('\n\n');
}

async function fetchJson(path: string, init: RequestInit = {}) {
  const app = activeServer();
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  const response = await fetch(`${app.baseUrl}${path}`, { ...init, headers });
  const body = await response.json() as unknown;
  expectRecord(body);
  return { response, body };
}

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

function collections(body: JsonRecord): JsonRecord[] {
  expectRecord(body.embedder);
  expect(Array.isArray(body.embedder.collections)).toBe(true);
  return body.embedder.collections as JsonRecord[];
}

function results(body: JsonRecord): JsonRecord[] {
  expect(Array.isArray(body.results)).toBe(true);
  return body.results as JsonRecord[];
}

function minedRows(dbPath: string): StoredRow[] {
  const sqlite = new Database(dbPath, { readonly: true });
  try {
    return sqlite.prepare(`
      SELECT d.id, d.source_file, d.project, d.concepts, f.content
      FROM oracle_documents d
      JOIN oracle_fts f ON f.id = d.id
      WHERE d.created_by = 'mine'
      ORDER BY d.id
    `).all() as StoredRow[];
  } finally {
    sqlite.close();
  }
}
