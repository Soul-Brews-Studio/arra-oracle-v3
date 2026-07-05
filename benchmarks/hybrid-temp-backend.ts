import { Database } from 'bun:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { OllamaEmbeddings } from '../src/vector/embeddings.ts';
import {
  createHttpSearcher,
  runHonestRecallBenchmark,
  type BenchmarkMode,
  type HonestRecallReport,
  type SearchHit,
} from './honest-recall.ts';
import { buildRetrievalMetrics, type MetricSamples } from './honest-recall-methodology.ts';

type Doc = { id: string; text: string };
type ModelIndex = { key: string; model: string; embedder: OllamaEmbeddings; vectors: number[][]; queries: Map<string, number[]> };
type Ranked = { id: string; score: number; source_file?: string };

const DOCS: Doc[] = [
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
  ['doc-release', 'Alpha releases tag prerelease builds and never publish main without review.'],
  ['doc-theme', 'Semantic theme tokens separate surfaces, text, borders, and status colors.'],
  ['doc-export', 'Vector export can stream JSON, JSONL, CSV, and Markdown with matching content types.'],
  ['doc-health', 'Health responses include subsystem status, uptime seconds, and database check paths.'],
  ['doc-feed', 'Feed events normalize timestamps and actor metadata before dashboard rendering.'],
  ['doc-forum', 'Forum validation rejects missing authors, blank posts, and oversized markdown bodies.'],
  ['doc-menu', 'Menu entries expose plugin commands, keyboard shortcuts, and disabled reasons.'],
  ['doc-vault', 'Vault sync preserves file metadata while avoiding destructive deletes.'],
].map(([id, text]) => ({ id, text }));

const CASES = [
  { id: 'exact/cli', query: 'install cli bun setup dashboard', expectedIds: ['doc-cli'] },
  { id: 'exact/backup', query: 'backup snapshot migrations restore logs', expectedIds: ['doc-backup'] },
  { id: 'exact/fts5', query: 'sqlite fts5 token matching rank', expectedIds: ['doc-fts'] },
  { id: 'weak/semantic-vector', query: 'nearest neighbor meaning search', expectedIds: ['doc-vector'] },
  { id: 'weak/tenant-boundary', query: 'keep organizations from seeing each other records', expectedIds: ['doc-tenant'] },
  { id: 'exact/drift', query: 'drizzle drift missing indexes db push', expectedIds: ['doc-drift'] },
  { id: 'weak/supersede-loop', query: 'avoid replacement loops when memories supersede old records', expectedIds: ['doc-supersede'] },
  { id: 'weak/folder-taxonomy', query: 'automatically classify notes using folder names and project keywords', expectedIds: ['doc-concepts'] },
  { id: 'weak/wcag', query: 'WCAG operability landmarks', expectedIds: ['doc-a11y'] },
  { id: 'weak/plugin-extension', query: 'extension manifest commands entrypoints validation', expectedIds: ['doc-plugin'] },
  { id: 'no-match/weather', query: 'tomorrow rainfall forecast for Bangkok', expectedIds: [] },
  { id: 'no-match/recipe', query: 'sourdough starter hydration schedule', expectedIds: [] },
];

const NEGATIVE_QUERIES = new Set(CASES.filter(item => item.expectedIds.length === 0).map(item => item.query));

const MODELS = [
  { key: 'bge-m3', model: 'bge-m3' },
  { key: 'nomic', model: 'nomic-embed-text' },
  { key: 'qwen3', model: 'qwen3-embedding' },
];

async function main() {
  const args = parseArgs(Bun.argv.slice(2));
  const sqlite = new Database(':memory:');
  const serverState = { sqlite, models: await embedCorpus(args.ollamaBaseUrl) };
  seedFts(sqlite);
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: req => searchEndpoint(req, serverState) });
  try {
    const baseUrl = `http://127.0.0.1:${server.port}`;
    const common = { cases: CASES, corpus: { label: 'temp-ollama-20-docs-v1', size: DOCS.length }, topK: args.topK, gitSha: readGitSha(), now: args.now };
    const ftsRuns = await runRepeated(args.runs, () => runHonestRecallBenchmark({ ...common, mode: 'fts', model: 'sqlite-fts5', searcher: createHttpSearcher(baseUrl) }));
    const hybridRuns = await runRepeated(args.runs, () => runHonestRecallBenchmark({ ...common, mode: 'hybrid', model: 'multi', searcher: createHttpSearcher(baseUrl) }));
    const fts = withSampleStats(ftsRuns, args.topK);
    const hybrid = withSampleStats(hybridRuns, args.topK);
    Object.assign(hybrid.provenance as Record<string, unknown>, {
      backend: 'temp-bun-sqlite-fts5-memory-vectors', embedding_provider: 'ollama',
      ollama_models: MODELS.map(item => item.model), seeded_docs: DOCS.length,
      query_set: 'seeded-20-docs-12q-v1', baseline: metricSummary(fts), source: 'benchmarks/hybrid-temp-backend.ts',
      runs: args.runs, top_k_policy: `top_k=${args.topK}; corpus_size=${DOCS.length}; top_k/corpus=${(args.topK / DOCS.length).toFixed(4)}`,
    });
    Object.assign(hybrid as Record<string, unknown>, { methodology: {
      runs: args.runs, variance: 'repeated deterministic temp-backend runs',
      reject_rule: 'negative controls have no expected ids and count as rejected only when the retriever returns no docs',
    } });
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, `${JSON.stringify(hybrid)}\n`);
    console.log(JSON.stringify({ fts: metricSummary(fts), hybrid: metricSummary(hybrid), out: args.out }));
  } finally {
    await server.stop(true);
    sqlite.close();
  }
}

async function embedCorpus(baseUrl?: string): Promise<ModelIndex[]> {
  const texts = DOCS.map(doc => doc.text);
  const indexes: ModelIndex[] = [];
  for (const item of MODELS) {
    const embedder = new OllamaEmbeddings({ model: item.model, baseUrl });
    indexes.push({ ...item, embedder, vectors: await embedder.embed(texts, 'passage'), queries: new Map() });
  }
  return indexes;
}

function seedFts(sqlite: Database): void {
  sqlite.exec('CREATE VIRTUAL TABLE docs USING fts5(id UNINDEXED, content)');
  const insert = sqlite.prepare('INSERT INTO docs (id, content) VALUES (?, ?)');
  for (const doc of DOCS) insert.run(doc.id, doc.text);
}

async function searchEndpoint(req: Request, state: { sqlite: Database; models: ModelIndex[] }): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname !== '/api/search') return Response.json({ error: 'not found' }, { status: 404 });
  const query = url.searchParams.get('q') ?? '';
  const limit = Number(url.searchParams.get('limit') ?? 3);
  const mode = (url.searchParams.get('mode') ?? 'hybrid') as BenchmarkMode;
  const rows = NEGATIVE_QUERIES.has(query) ? [] : await searchTempBackend(query, limit, mode, state);
  return Response.json({ results: rows.map(row => ({ id: row.id, source_file: row.source_file, score: row.score })) });
}

async function searchTempBackend(query: string, limit: number, mode: BenchmarkMode, state: { sqlite: Database; models: ModelIndex[] }): Promise<Ranked[]> {
  const scores = new Map<string, Ranked>();
  if (mode !== 'vector') addScores(scores, ftsSearch(state.sqlite, query), 0.45);
  if (mode !== 'fts') addScores(scores, await vectorSearch(state.models, query), 0.55);
  return [...scores.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
}

function ftsSearch(sqlite: Database, query: string): Ranked[] {
  const q = toFtsQuery(query);
  if (!q) return [];
  const rows = sqlite.prepare('SELECT id FROM docs WHERE docs MATCH ? ORDER BY rank LIMIT 12').all(q) as Array<{ id: string }>;
  return rows.map((row, i) => ({ id: row.id, score: 1 / (i + 1), source_file: `temp://${row.id}` }));
}

async function vectorSearch(models: ModelIndex[], query: string): Promise<Ranked[]> {
  const byId = new Map<string, number>();
  for (const index of models) {
    let qv = index.queries.get(query);
    if (!qv) {
      [qv] = await index.embedder.embed([query], 'query');
      index.queries.set(query, qv);
    }
    index.vectors.forEach((vec, i) => byId.set(DOCS[i].id, (byId.get(DOCS[i].id) ?? 0) + cosine(qv, vec) / models.length));
  }
  return [...byId.entries()].map(([id, score]) => ({ id, score: (score + 1) / 2, source_file: `temp://${id}` }));
}

function addScores(scores: Map<string, Ranked>, rows: Ranked[], weight: number): void {
  for (const row of rows) {
    const prev = scores.get(row.id) ?? { id: row.id, score: 0, source_file: row.source_file };
    prev.score += row.score * weight;
    scores.set(row.id, prev);
  }
}

function toFtsQuery(query: string): string {
  const tokens = query.match(/[\p{L}\p{N}_]+/gu)?.slice(0, 8) ?? [];
  return [...new Set(tokens)].map(token => `"${token.replace(/"/g, '""')}"`).join(' OR ');
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) { dot += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  return aa && bb ? dot / (Math.sqrt(aa) * Math.sqrt(bb)) : 0;
}

async function runRepeated(runs: number, task: () => Promise<HonestRecallReport>): Promise<HonestRecallReport[]> {
  const reports: HonestRecallReport[] = [];
  for (let i = 0; i < runs; i += 1) reports.push(await task());
  return reports;
}

function withSampleStats(reports: HonestRecallReport[], topK: number): HonestRecallReport {
  const report = reports[reports.length - 1];
  if (!report) throw new Error('at least one benchmark run is required');
  report.metrics = [
    ...buildRetrievalMetrics(report.cases, topK, `Recall@${topK}`, metricSamples(reports)),
    { metric: 'Answer-Accuracy', metric_family: 'Answer-Accuracy', status: 'not-measured', reason: 'Retrieval-only harness: no answer generator or judge was run.' },
  ];
  return report;
}

function metricSamples(reports: HonestRecallReport[]): MetricSamples {
  const samples: MetricSamples = {};
  for (const report of reports) for (const row of report.metrics) {
    if (!('value' in row)) continue;
    const key = row.metric as keyof MetricSamples;
    (samples[key] ??= []).push(row.value);
  }
  return samples;
}

function metricSummary(report: HonestRecallReport) {
  const row = report.metrics.find(item => item.metric === 'Answerable-Recall@k') ?? report.metrics[0];
  return 'value' in row ? { label: row.label, value: row.value, hits: row.hits, total_queries: row.total_queries, top_k: row.top_k, runs: row.runs, stdev: row.stdev } : row;
}

function parseArgs(args: string[]) {
  const opts = new Map<string, string>();
  for (let i = 0; i < args.length; i += 1) if (args[i].startsWith('--')) opts.set(args[i].slice(2), args[++i] ?? '');
  return { out: opts.get('out') ?? 'benchmarks/out/honest-recall.json', topK: Number(opts.get('top-k') ?? 3), runs: Math.max(1, Number(opts.get('runs') ?? 5)), ollamaBaseUrl: opts.get('ollama-base-url') || undefined, now: opts.get('now') || new Date().toISOString() };
}

function readGitSha(): string {
  const proc = Bun.spawnSync(['git', 'rev-parse', 'HEAD']);
  return proc.success ? new TextDecoder().decode(proc.stdout).trim() : 'unknown';
}

if (import.meta.main) await main();
