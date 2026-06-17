import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type MetricName = 'Recall@k' | 'Answer-Accuracy';
export type BenchmarkMode = 'hybrid' | 'fts' | 'vector';
type RecallMetricLabel = `Recall@${number}`;

export type BenchmarkCase = { id: string; query: string; expectedIds: string[]; expectedAnswer?: string };

export type SearchHit = { id: string; source_file?: string; sourceFile?: string };
export type SearchRequest = { query: string; topK: number; mode: BenchmarkMode; model: string };
export type Searcher = (request: SearchRequest) => Promise<SearchHit[]>;

type CorpusRef = { label: string; size: number };

type MetricRow =
  | { metric: 'Recall@k'; metric_family: 'Recall@k'; label: RecallMetricLabel; value: number; hits: number; total_queries: number; top_k: number }
  | { metric: 'Answer-Accuracy'; metric_family: 'Answer-Accuracy'; status: 'not-measured'; reason: string };

export type HonestRecallReport = {
  schema: 'arra.honest-recall.v1';
  generated_at: string;
  provenance: {
    mode: BenchmarkMode;
    model: string;
    top_k: number;
    corpus: CorpusRef;
    metric: 'Recall@k';
    metric_family: 'Recall@k';
    'git-sha': string;
    stack: string[];
  };
  metrics: MetricRow[];
  cases: Array<{
    id: string;
    query: string;
    metric: 'Recall@k';
    metric_family: 'Recall@k';
    expected_ids: string[];
    retrieved_ids: string[];
    hit: boolean;
    matched_rank: number | null;
  }>;
};

export function guardTopK(topK: number, corpusSize: number): void {
  if (!Number.isSafeInteger(topK) || topK < 1) throw new Error('top_k must be a positive integer');
  if (!Number.isSafeInteger(corpusSize) || corpusSize < 1) throw new Error('corpus_size must be a positive integer');
  if (topK >= corpusSize) {
    throw new Error(`Refusing to report Recall@${topK}: top_k (${topK}) must be smaller than corpus_size (${corpusSize}).`);
  }
}

function validateBenchmarkInputs(cases: BenchmarkCase[], corpus: CorpusRef, topK: number): void {
  if (!cases.length) throw new Error('benchmark dataset has no cases');
  if (!stringField(corpus.label)) throw new Error('benchmark corpus/collection label is required');
  guardTopK(topK, corpus.size);
}

export function parseDatasetText(text: string): BenchmarkCase[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const rawItems = trimmed.startsWith('[')
    ? JSON.parse(trimmed) as unknown[]
    : trimmed.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as unknown);
  return rawItems.map(parseCase);
}

export function createHttpSearcher(baseUrl: string): Searcher {
  return async ({ query, topK, mode, model }) => {
    const url = new URL('/api/search', baseUrl);
    url.searchParams.set('q', query);
    url.searchParams.set('limit', String(topK));
    url.searchParams.set('mode', mode);
    url.searchParams.set('model', model);
    const response = await fetch(url);
    const body = await response.json() as { results?: unknown[]; error?: string };
    if (!response.ok) throw new Error(body.error || `search failed with HTTP ${response.status}`);
    return (Array.isArray(body.results) ? body.results : []).map(toHit).filter(Boolean) as SearchHit[];
  };
}

export async function runHonestRecallBenchmark(options: {
  cases: BenchmarkCase[];
  corpus: CorpusRef;
  topK: number;
  mode?: BenchmarkMode;
  model?: string;
  searcher: Searcher;
  outFile?: string;
  gitSha?: string;
  now?: string;
}): Promise<HonestRecallReport> {
  const mode = normalizeMode(options.mode ?? 'hybrid');
  const model = options.model ?? 'multi';
  const recallLabel = recallMetric(options.topK);
  validateBenchmarkInputs(options.cases, options.corpus, options.topK);

  const cases: HonestRecallReport['cases'] = [];
  for (const item of options.cases) {
    const hits = (await options.searcher({ query: item.query, topK: options.topK, mode, model })).slice(0, options.topK);
    const expected = new Set(item.expectedIds);
    const matchedIndex = hits.findIndex((hit) => keysForHit(hit).some((key) => expected.has(key)));
    cases.push({
      id: item.id,
      query: item.query,
      metric: 'Recall@k',
      metric_family: 'Recall@k',
      expected_ids: item.expectedIds,
      retrieved_ids: hits.map((hit) => hit.id),
      hit: matchedIndex >= 0,
      matched_rank: matchedIndex >= 0 ? matchedIndex + 1 : null,
    });
  }

  const hits = cases.filter((item) => item.hit).length;
  const recall = roundMetric(hits / cases.length);
  const report: HonestRecallReport = {
    schema: 'arra.honest-recall.v1',
    generated_at: options.now ?? new Date().toISOString(),
    provenance: {
      mode,
      model,
      top_k: options.topK,
      corpus: options.corpus,
      metric: 'Recall@k',
      metric_family: 'Recall@k',
      'git-sha': options.gitSha ?? readGitSha(),
      stack: mode === 'hybrid' && model === 'multi' ? ['bge-m3', 'nomic', 'qwen3', 'FTS5'] : [model, mode],
    },
    metrics: [
      { metric: 'Recall@k', metric_family: 'Recall@k', label: recallLabel, value: recall, hits, total_queries: cases.length, top_k: options.topK },
      { metric: 'Answer-Accuracy', metric_family: 'Answer-Accuracy', status: 'not-measured', reason: 'Retrieval-only harness: no answer generator or judge was run.' },
    ],
    cases,
  };

  if (options.outFile) {
    mkdirSync(dirname(options.outFile), { recursive: true });
    writeFileSync(options.outFile, `${JSON.stringify(report)}\n`);
  }
  return report;
}

function normalizeMode(value: string): BenchmarkMode {
  if (value === 'hybrid' || value === 'fts' || value === 'vector') return value;
  throw new Error('mode must be one of: hybrid, fts, vector');
}

function recallMetric(topK: number): RecallMetricLabel {
  guardTopK(topK, Number.MAX_SAFE_INTEGER);
  return `Recall@${topK}`;
}

function parseCase(raw: unknown, index: number): BenchmarkCase {
  const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const query = stringField(row.query) || stringField(row.question);
  const rawExpected = row.expectedIds ?? row.expected_ids ?? row.expected_doc_ids ?? row.relevant_ids ?? row.target_ids ?? row.evidence_ids, expectedIds = stringArray(rawExpected);
  if (!query) throw new Error(`case ${index + 1} missing query/question`);
  if (!Array.isArray(rawExpected)) throw new Error(`case ${index + 1} missing expected/relevant ids`);
  return {
    id: stringField(row.id) || `case-${index + 1}`,
    query,
    expectedIds,
    expectedAnswer: stringField(row.answer ?? row.expected_answer),
  };
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(stringField).filter(Boolean);
}

function toHit(value: unknown): SearchHit | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const id = stringField(row.id);
  return id ? { id, source_file: stringField(row.source_file), sourceFile: stringField(row.sourceFile) } : null;
}

function keysForHit(hit: SearchHit): string[] {
  return [hit.id, hit.source_file, hit.sourceFile].filter((key): key is string => Boolean(key));
}

function roundMetric(value: number): number {
  return Number(value.toFixed(6));
}

function readGitSha(): string {
  const proc = Bun.spawnSync(['git', 'rev-parse', 'HEAD']);
  return proc.success ? new TextDecoder().decode(proc.stdout).trim() : 'unknown';
}

function parseArgs(args: string[]) {
  const opts = new Map<string, string>();
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith('--')) continue;
    opts.set(arg.slice(2), args[i + 1] ?? '');
    i += 1;
  }
  return {
    dataset: required(opts, 'dataset'),
    corpus: opts.get('corpus') || 'oracle-hybrid-kb',
    corpusSize: Number(opts.get('corpus-size')),
    topK: Number(opts.get('top-k') ?? 10),
    mode: normalizeMode(opts.get('mode') ?? 'hybrid'),
    model: opts.get('model') ?? 'multi',
    baseUrl: opts.get('base-url') ?? 'http://127.0.0.1:47778',
    outFile: opts.get('out') ?? 'benchmarks/out/honest-recall.json',
  };
}

function required(opts: Map<string, string>, key: string): string {
  const value = opts.get(key);
  if (!value) throw new Error(`missing --${key}`);
  return value;
}

function printSummary(report: HonestRecallReport): void {
  const recall = report.metrics.find((row): row is Extract<MetricRow, { metric_family: 'Recall@k' }> => row.metric_family === 'Recall@k');
  if (!recall) throw new Error('Recall@k metric row missing');
  console.log(`${recall.label}: ${recall.value} (${recall.hits}/${recall.total_queries})`);
  console.log('Answer-Accuracy: NOT MEASURED — retrieval-only harness');
  console.log(`provenance_json: ${report.provenance.mode}/${report.provenance.model} top_k=${report.provenance.top_k}`);
}

if (import.meta.main) {
  try {
    const cli = parseArgs(Bun.argv.slice(2));
    const cases = parseDatasetText(readFileSync(cli.dataset, 'utf8'));
    const report = await runHonestRecallBenchmark({
      cases,
      topK: cli.topK,
      corpus: { label: cli.corpus, size: cli.corpusSize },
      mode: cli.mode,
      model: cli.model,
      searcher: createHttpSearcher(cli.baseUrl),
      outFile: cli.outFile,
    });
    printSummary(report);
  } catch (error) {
    console.error(`HONEST BENCHMARK REFUSED: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
