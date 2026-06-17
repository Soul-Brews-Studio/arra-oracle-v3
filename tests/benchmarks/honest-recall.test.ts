import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createHttpSearcher,
  guardTopK,
  parseDatasetText,
  runHonestRecallBenchmark,
  type Searcher,
} from '../../benchmarks/honest-recall.ts';

const roots: string[] = [];

function tempFile(name: string): string {
  const root = mkdtempSync(join(tmpdir(), 'arra-honest-bench-'));
  roots.push(root);
  return join(root, name);
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('honest recall benchmark harness', () => {
  test('refuses to report Recall@k when top_k covers the corpus', async () => {
    const outFile = tempFile('refused.json');
    expect(() => guardTopK(12, 12)).toThrow('Refusing to report Recall@12');
    expect(() => guardTopK(4, 4)).toThrow('Refusing to report Recall@4');
    expect(() => guardTopK(5, 4)).toThrow('top_k (5) must be smaller than corpus_size (4)');
    const searcher: Searcher = async () => { throw new Error('searcher should not run'); };

    await expect(runHonestRecallBenchmark({
      cases: [{ id: 'q1', query: 'alpha', expectedIds: ['doc-a'] }],
      corpus: { label: 'tiny', size: 4 },
      topK: 5,
      searcher,
      outFile,
      gitSha: 'abc123',
    })).rejects.toThrow('top_k (5) must be smaller than corpus_size (4)');
    expect(existsSync(outFile)).toBe(false);
  });

  test('refuses empty datasets and missing corpus labels before searching', async () => {
    const outFile = tempFile('empty.json');
    let searchCalls = 0;
    const searcher: Searcher = async () => { searchCalls += 1; return []; };

    await expect(runHonestRecallBenchmark({
      cases: parseDatasetText(' \n '),
      corpus: { label: 'oracle-test', size: 10 },
      topK: 3,
      searcher,
      outFile,
      gitSha: 'abc123',
    })).rejects.toThrow('benchmark dataset has no cases');
    await expect(runHonestRecallBenchmark({
      cases: [{ id: 'q1', query: 'alpha', expectedIds: ['doc-a'] }],
      corpus: { label: '', size: 10 },
      topK: 3,
      searcher,
      outFile,
      gitSha: 'abc123',
    })).rejects.toThrow('benchmark corpus/collection label is required');
    expect(searchCalls).toBe(0);
    expect(existsSync(outFile)).toBe(false);
  });

  test('writes provenance JSON and separates Recall@k from Answer-Accuracy', async () => {
    const outFile = tempFile('report.json');
    const searcher: Searcher = async ({ query }) => query === 'alpha'
      ? [{ id: 'noise' }, { id: 'doc-a' }]
      : [{ id: 'noise' }, { id: 'other' }];

    const report = await runHonestRecallBenchmark({
      cases: parseDatasetText([
        JSON.stringify({ id: 'q1', query: 'alpha', expected_ids: ['doc-a'], answer: 'A' }),
        JSON.stringify({ id: 'q2', query: 'beta', relevant_ids: ['doc-b'], answer: 'B' }),
      ].join('\n')),
      corpus: { label: 'oracle-test', size: 10 },
      topK: 3,
      searcher,
      outFile,
      gitSha: 'abc123',
      now: '2026-06-17T00:00:00.000Z',
    });

    expect(report.provenance).toMatchObject({ mode: 'hybrid', model: 'multi', top_k: 3, metric: 'Recall@k', metric_family: 'Recall@k', 'git-sha': 'abc123' });
    expect(report.provenance.stack).toEqual(['bge-m3', 'nomic', 'qwen3', 'FTS5']);
    expect(report.metrics[0]).toMatchObject({ metric: 'Recall@k', metric_family: 'Recall@k', label: 'Recall@3', value: 0.5, hits: 1, total_queries: 2 });
    expect(report.metrics[1]).toMatchObject({ metric: 'Answer-Accuracy', metric_family: 'Answer-Accuracy', status: 'not-measured' });
    expect(report.metrics.map((item) => item.metric)).toEqual(['Recall@k', 'Answer-Accuracy']);
    expect('value' in report.metrics[1]).toBe(false);
    expect(report.cases.map((item) => item.metric)).toEqual(['Recall@k', 'Recall@k']);
    expect(report.cases.map((item) => item.metric_family)).toEqual(['Recall@k', 'Recall@k']);
    expect(JSON.parse(readFileSync(outFile, 'utf8')).provenance.corpus).toEqual({ label: 'oracle-test', size: 10 });
  });

  test('shipped public recall dataset is parseable and does not leak private paths', () => {
    const text = readFileSync('benchmarks/fixtures/recall-dataset.jsonl', 'utf8');
    const lines = text.trim().split('\n');
    const cases = parseDatasetText(text);

    expect(lines.length).toBeGreaterThanOrEqual(30);
    expect(lines.length).toBeLessThanOrEqual(50);
    expect(cases).toHaveLength(lines.length);
    expect(cases.every((item) => item.id && item.query && Array.isArray(item.expectedIds))).toBe(true);
    expect(cases.filter((item) => item.id.includes('multi-word'))).toHaveLength(4);
    expect(cases.filter((item) => item.id.includes('no-match'))).toHaveLength(4);
    expect(cases.filter((item) => item.expectedIds.length === 0).map((item) => item.id).sort())
      .toEqual(['edge/no-match-personal', 'edge/no-match-recipes', 'edge/no-match-sports', 'edge/no-match-weather']);
    expect(() => parseDatasetText('{"id":"bad","query":"missing expected ids"}')).toThrow('missing expected/relevant ids');
    expect(text).not.toContain('\u03c8/');
    expect(text).not.toContain('/Users/');
  });

  test('rejects invalid mode before search or provenance output', async () => {
    const outFile = tempFile('bad-mode.json');
    const searcher: Searcher = async () => { throw new Error('searcher should not run'); };

    await expect(runHonestRecallBenchmark({
      cases: [{ id: 'q1', query: 'alpha', expectedIds: ['doc-a'] }],
      corpus: { label: 'oracle-test', size: 10 },
      topK: 3,
      mode: 'fake' as never,
      searcher,
      outFile,
      gitSha: 'abc123',
    })).rejects.toThrow('mode must be one of: hybrid, fts, vector');
    expect(existsSync(outFile)).toBe(false);
  });

  test('published headline artifact records hybrid multi-model provenance', () => {
    const report = JSON.parse(readFileSync('benchmarks/out/honest-recall.json', 'utf8'));
    expect(report.provenance).toMatchObject({
      mode: 'hybrid', model: 'multi', top_k: 3, metric: 'Recall@k', metric_family: 'Recall@k',
    });
    expect(report.provenance.stack).toEqual(['bge-m3', 'nomic', 'qwen3', 'FTS5']);
    expect(report.provenance.corpus).toEqual({ label: 'public-recall-dataset-v2', size: 48 });
    expect(report.metrics[0]).toMatchObject({ metric: 'Recall@k', label: 'Recall@3', value: 0.833333, hits: 40, total_queries: 48 });
    expect(report.cases).toHaveLength(48);
    expect(report.cases.find((item: { id: string }) => item.id === 'vector/preflight')).toMatchObject({ hit: false });
    expect(report.cases.find((item: { id: string }) => item.id === 'edge/no-match-weather')).toMatchObject({ expected_ids: [], hit: false });
  });

  test('HTTP searcher calls our hybrid multi-model search surface', async () => {
    const seen: string[] = [];
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        seen.push(url.searchParams.toString());
        return Response.json({ results: [{ id: 'doc-a', source_file: 'vault/a.md' }] });
      },
    });
    try {
      const hits = await createHttpSearcher(`http://127.0.0.1:${server.port}`)({ query: 'needle', topK: 7, mode: 'hybrid', model: 'multi' });
      expect(hits).toEqual([{ id: 'doc-a', source_file: 'vault/a.md', sourceFile: '' }]);
      expect(seen[0]).toContain('q=needle');
      expect(seen[0]).toContain('limit=7');
      expect(seen[0]).toContain('mode=hybrid');
      expect(seen[0]).toContain('model=multi');
    } finally {
      await server.stop(true);
    }
  });

  test('runs deterministic FTS Recall@10 against a seeded in-memory DB', async () => {
    const sqlite = new Database(':memory:');
    try {
      seedFtsCorpus(sqlite);
      const report = await runHonestRecallBenchmark({
        cases: seededCases(),
        corpus: { label: 'seeded-fts-memory', size: 12 },
        topK: 10,
        mode: 'fts',
        model: 'sqlite-fts5',
        searcher: createSqliteFtsSearcher(sqlite),
        gitSha: 'test-sha',
        now: '2026-06-17T00:00:00.000Z',
      });

      const recall = report.metrics[0];
      expect(recall).toMatchObject({ metric: 'Recall@k', label: 'Recall@10', top_k: 10 });
      expect(recall.metric_family).toBe('Recall@k');
      expect('value' in recall && typeof recall.value === 'number').toBe(true);
      if ('value' in recall && typeof recall.value === 'number') expect(recall.value).toBeGreaterThanOrEqual(0.7);
      expect(report.provenance).toMatchObject({ mode: 'fts', model: 'sqlite-fts5', top_k: 10 });
      expect(report.cases.every((row) => row.retrieved_ids.length <= 10)).toBe(true);
    } finally {
      sqlite.close();
    }
  });
});

function seedFtsCorpus(sqlite: Database): void {
  sqlite.exec('CREATE VIRTUAL TABLE docs USING fts5(id UNINDEXED, content)');
  const insert = sqlite.prepare('INSERT INTO docs (id, content) VALUES (?, ?)');
  for (const [id, content] of seededDocs()) insert.run(id, content);
}

function createSqliteFtsSearcher(sqlite: Database): Searcher {
  return async ({ query, topK }) => sqlite.prepare(`
    SELECT id FROM docs WHERE docs MATCH ? ORDER BY rank LIMIT ?
  `).all(toFtsQuery(query), topK) as Array<{ id: string }>;
}

function toFtsQuery(query: string): string {
  const tokens = query.match(/[\p{L}\p{N}_]+/gu)?.slice(0, 8) ?? [];
  return [...new Set(tokens)].map((token) => `"${token.replace(/"/g, '""')}"`).join(' OR ');
}

function seededDocs(): Array<[string, string]> {
  return [
    ['doc-cli', 'Install the Arra Oracle CLI with Bun, run setup, then open the local dashboard.'],
    ['doc-backup', 'Before database migrations take a backup snapshot and verify restore logs.'],
    ['doc-fts', 'SQLite FTS5 provides full text search with token matching and rank ordering.'],
    ['doc-vector', 'Vector search uses embeddings for semantic nearest neighbor retrieval.'],
    ['doc-tenant', 'Tenant isolation scopes every database query by tenant id to prevent leakage.'],
    ['doc-drift', 'Drizzle drift recovery recreates missing indexes after db push skips them.'],
    ['doc-supersede', 'Supersede chain integrity prevents replacement cycles in memory records.'],
    ['doc-concepts', 'Concept extraction derives project names from folder paths and keywords.'],
    ['doc-a11y', 'Accessibility checks include keyboard focus, landmarks, headings, and contrast.'],
    ['doc-federation', 'OracleNet federation exchanges peer health and manifests between nodes.'],
    ['doc-schedule', 'Scheduled jobs store cron expressions, retry metadata, and next run times.'],
    ['doc-plugin', 'Canvas plugins declare manifests, commands, entrypoints, and validation rules.'],
  ];
}

function seededCases() {
  return parseDatasetText([
    { id: 'q-cli', query: 'install cli bun setup dashboard', expected_ids: ['doc-cli'] },
    { id: 'q-backup', query: 'backup snapshot migrations restore logs', expected_ids: ['doc-backup'] },
    { id: 'q-fts', query: 'sqlite fts5 token matching rank', expected_ids: ['doc-fts'] },
    { id: 'q-vector', query: 'embeddings semantic nearest neighbor', expected_ids: ['doc-vector'] },
    { id: 'q-tenant', query: 'tenant id query scope leakage', expected_ids: ['doc-tenant'] },
    { id: 'q-drift', query: 'drizzle drift missing indexes db push', expected_ids: ['doc-drift'] },
    { id: 'q-supersede', query: 'supersede replacement cycles memory records', expected_ids: ['doc-supersede'] },
    { id: 'q-concepts', query: 'derive project folder keywords', expected_ids: ['doc-concepts'] },
    { id: 'q-a11y', query: 'keyboard focus landmarks contrast', expected_ids: ['doc-a11y'] },
    { id: 'q-plugin', query: 'canvas plugin manifests commands validation', expected_ids: ['doc-plugin'] },
  ].map((row) => JSON.stringify(row)).join('\n'));
}
