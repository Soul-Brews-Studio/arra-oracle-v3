import { Database } from 'bun:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import type { EmbeddingProvider } from './types.ts';

export type DriftDoc = { id: string; text: string; sourceFile: string; language: 'thai' | 'other' };
export type DriftQuery = { id: string; text: string };
export type BenchmarkConfig = {
  dbPath?: string;
  repoRoot?: string;
  sampleSize?: number;
  queryCount?: number;
  topK?: number;
  reportDir?: string;
  now?: Date;
  queries?: string[];
};
export type ProviderBundle = { local: EmbeddingProvider; cloudflare?: EmbeddingProvider };
export type DriftMetrics = {
  docCount: number;
  queryCount: number;
  topK: number;
  meanCosine: number;
  meanDrift: number;
  p95Drift: number;
  avgTopKOverlap: number;
  verdict: 'warn-mode-ok' | 'separate-collection';
  queryOverlaps: Array<{ query: string; overlap: number; localTop: string[]; cloudflareTop: string[] }>;
};
export type BenchmarkResult = {
  docs: DriftDoc[];
  queries: DriftQuery[];
  local: { provider: string; dimensions: number; embedded: number };
  cloudflare?: { provider: string; dimensions: number; embedded: number };
  metrics?: DriftMetrics;
  reportPath: string;
  status: 'measured' | 'local-only';
};

const DEFAULT_SAMPLE = 100;
const DEFAULT_QUERIES = 8;
const DEFAULT_TOP_K = 10;
const DRIFT_THRESHOLD = 0.05;
const THAI_RE = /[\u0E00-\u0E7F]/;

type Embeddings = { docs: number[][]; queries: number[][] };

export async function runBgeM3DriftBenchmark(config: BenchmarkConfig, providers: ProviderBundle): Promise<BenchmarkResult> {
  const sampleSize = positive(config.sampleSize, DEFAULT_SAMPLE);
  const queryCount = positive(config.queryCount, DEFAULT_QUERIES);
  const topK = positive(config.topK, DEFAULT_TOP_K);
  const now = config.now ?? new Date();
  const docs = loadBenchmarkDocs(config, sampleSize);
  if (docs.length === 0) throw new Error('No benchmark documents found in SQLite corpus or repo markdown fallback');
  const queries = buildQueries(docs, config.queries, queryCount);
  const local = await embedAll(providers.local, docs, queries);
  let cloudflare: Embeddings | undefined;
  if (providers.cloudflare) cloudflare = await embedAll(providers.cloudflare, docs, queries);
  const metrics = cloudflare ? computeDriftMetrics(docs, queries, local, cloudflare, topK) : undefined;
  const result: BenchmarkResult = {
    docs,
    queries,
    local: { provider: providers.local.name, dimensions: providers.local.dimensions, embedded: local.docs.length },
    ...(cloudflare && providers.cloudflare ? {
      cloudflare: { provider: providers.cloudflare.name, dimensions: providers.cloudflare.dimensions, embedded: cloudflare.docs.length },
      metrics,
      status: 'measured' as const,
    } : { status: 'local-only' as const }),
    reportPath: '',
  };
  result.reportPath = writeReport(config.reportDir ?? defaultReportDir(config.repoRoot), now, result);
  return result;
}

export function loadBenchmarkDocs(config: BenchmarkConfig, sampleSize = DEFAULT_SAMPLE): DriftDoc[] {
  const fromDb = readSqliteDocs(config.dbPath).slice(0, sampleSize * 4);
  const candidates = fromDb.length ? fromDb : readMarkdownDocs(config.repoRoot ?? process.cwd(), sampleSize * 4);
  return mixedSample(candidates, sampleSize);
}

export function computeDriftMetrics(docs: DriftDoc[], queries: DriftQuery[], local: Embeddings, cf: Embeddings, topK = DEFAULT_TOP_K): DriftMetrics {
  assertAligned(local.docs, cf.docs, docs.length, 'document');
  assertAligned(local.queries, cf.queries, queries.length, 'query');
  const cosines = docs.map((_, i) => cosine(local.docs[i], cf.docs[i]));
  const drifts = cosines.map((value) => 1 - value).sort((a, b) => a - b);
  const queryOverlaps = queries.map((query, i) => {
    const localTop = rankDocs(docs, local.docs, local.queries[i], topK);
    const cloudflareTop = rankDocs(docs, cf.docs, cf.queries[i], topK);
    return { query: query.text, overlap: overlap(localTop, cloudflareTop), localTop, cloudflareTop };
  });
  const p95Drift = percentile(drifts, 0.95);
  return {
    docCount: docs.length,
    queryCount: queries.length,
    topK,
    meanCosine: round(mean(cosines)),
    meanDrift: round(mean(drifts)),
    p95Drift: round(p95Drift),
    avgTopKOverlap: round(mean(queryOverlaps.map((item) => item.overlap))),
    verdict: decideCompatibility(mean(drifts), p95Drift),
    queryOverlaps,
  };
}

export function decideCompatibility(meanDrift: number, p95Drift: number): DriftMetrics['verdict'] {
  return meanDrift < DRIFT_THRESHOLD && p95Drift < DRIFT_THRESHOLD ? 'warn-mode-ok' : 'separate-collection';
}

export function buildQueries(docs: DriftDoc[], explicit: string[] | undefined, queryCount = DEFAULT_QUERIES): DriftQuery[] {
  const texts = (explicit?.map((item) => item.trim()).filter(Boolean) ?? []).slice(0, queryCount);
  if (texts.length) return texts.map((text, i) => ({ id: `query-${i + 1}`, text }));
  return evenly(docs, Math.min(queryCount, docs.length)).map((doc, i) => ({ id: `query-${i + 1}`, text: queryFrom(doc.text) }));
}

function readSqliteDocs(dbPath?: string): DriftDoc[] {
  const file = dbPath || process.env.ORACLE_DB_PATH;
  if (!file || !fs.existsSync(file)) return [];
  const db = new Database(file, { readonly: true });
  try {
    const rows = db.query(`
      SELECT d.id, d.source_file AS sourceFile, f.content
      FROM oracle_documents d JOIN oracle_fts f ON f.id = d.id
      WHERE COALESCE(d.superseded_by, '') = '' AND LENGTH(f.content) >= 40
      ORDER BY d.indexed_at DESC, d.id ASC LIMIT 1000
    `).all() as Array<{ id: string; sourceFile: string; content: string }>;
    return rows.map((row) => doc(row.id, row.content, row.sourceFile));
  } catch { return []; }
  finally { db.close(); }
}

function readMarkdownDocs(repoRoot: string, limit: number): DriftDoc[] {
  const starts = ['ψ/memory', 'ψ/learn', 'docs', 'README.md'].map((item) => path.join(repoRoot, item));
  const docs: DriftDoc[] = [];
  const stack = starts.filter((item) => fs.existsSync(item));
  while (stack.length && docs.length < limit) {
    const current = stack.shift()!;
    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(current).sort()) stack.push(path.join(current, name));
      continue;
    }
    if (!current.endsWith('.md')) continue;
    const text = fs.readFileSync(current, 'utf8').replace(/---[\s\S]*?---/, '').trim();
    if (text.length >= 40) docs.push(doc(path.relative(repoRoot, current), text, path.relative(repoRoot, current)));
  }
  return docs;
}

function mixedSample(candidates: DriftDoc[], size: number): DriftDoc[] {
  const thai = candidates.filter((item) => item.language === 'thai');
  const other = candidates.filter((item) => item.language !== 'thai');
  const targetThai = Math.min(thai.length, Math.ceil(size / 2));
  const picked = [...evenly(thai, targetThai), ...evenly(other, size - targetThai)];
  return picked.length >= size ? picked.slice(0, size) : [...picked, ...evenly(candidates.filter((item) => !picked.includes(item)), size - picked.length)];
}

async function embedAll(provider: EmbeddingProvider, docs: DriftDoc[], queries: DriftQuery[]): Promise<Embeddings> {
  return { docs: await provider.embed(docs.map((item) => item.text), 'passage'), queries: await provider.embed(queries.map((item) => item.text), 'query') };
}

function writeReport(dir: string, now: Date, result: BenchmarkResult): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${now.toISOString().slice(0, 10)}_bge-m3-cf-local-drift.md`);
  fs.writeFileSync(file, reportMarkdown(now, result));
  return file;
}

function reportMarkdown(now: Date, result: BenchmarkResult): string {
  const m = result.metrics;
  const lines = [
    '---', 'title: bge-m3 CF Workers AI vs local Ollama drift benchmark', 'tags: [benchmark, bge-m3, cloudflare-ai, ollama]', `created: ${now.toISOString()}`, '---', '',
    '# bge-m3 drift benchmark — CF Workers AI vs local Ollama', '',
    'Decision rule: if mean and p95 cosine drift are both `<0.05`, local/CF mismatch may run with `ORACLE_VECTOR_IDENTITY_MISMATCH=warn`; if either is `>=0.05`, keep a separate collection and do not mix vectors.', '',
    'Run command: `bun run bench:bge-m3-drift`.',
    'Configuration is env-only: `BGE_DRIFT_DB_PATH`, `BGE_DRIFT_REPO_ROOT`, `BGE_DRIFT_REPORT_DIR`, `BGE_DRIFT_SAMPLE_SIZE`, `BGE_DRIFT_QUERY_COUNT`, `BGE_DRIFT_TOP_K`, `BGE_DRIFT_QUERIES`, `BGE_DRIFT_LOCAL_MODEL`, `OLLAMA_BASE_URL`/`OLLAMA_HOST`, `CLOUDFLARE_ACCOUNT_ID`/`ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`.', '',
    `Status: **${result.status}**`,
    `Corpus: ${result.docs.length} docs (${result.docs.filter((doc) => doc.language === 'thai').length} Thai / ${result.docs.filter((doc) => doc.language !== 'thai').length} other), ${result.queries.length} queries`,
    `Local: ${result.local.provider}, ${result.local.dimensions} dims, embedded ${result.local.embedded} docs`,
  ];
  if (!m) lines.push('', 'Cloudflare side skipped: missing `CLOUDFLARE_ACCOUNT_ID`/`ACCOUNT_ID` and/or `CLOUDFLARE_API_TOKEN` (#2680). Do not create a token in this harness run. Verdict: **pending; keep collections separate until measured**.');
  else lines.push(
    `Cloudflare: ${result.cloudflare?.provider}, ${result.cloudflare?.dimensions} dims, embedded ${result.cloudflare?.embedded} docs`, '',
    '| Metric | Value |', '| --- | ---: |',
    `| mean cosine | ${m.meanCosine} |`, `| mean drift | ${m.meanDrift} |`, `| p95 drift | ${m.p95Drift} |`, `| avg top-${m.topK} overlap | ${m.avgTopKOverlap} |`,
    `| verdict | ${m.verdict} |`, '',
    '| Query | overlap | local top | CF top |', '| --- | ---: | --- | --- |',
    ...m.queryOverlaps.map((q) => `| ${escapePipe(q.query)} | ${q.overlap} | ${q.localTop.slice(0, 3).join(', ')} | ${q.cloudflareTop.slice(0, 3).join(', ')} |`),
  );
  return `${lines.join('\n')}\n`;
}

function rankDocs(docs: DriftDoc[], vectors: number[][], query: number[], topK: number): string[] {
  return docs.map((doc, i) => ({ id: doc.id, score: cosine(vectors[i], query) })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, topK).map((item) => item.id);
}
function doc(id: string, text: string, sourceFile: string): DriftDoc { return { id, text: text.slice(0, 3000), sourceFile, language: THAI_RE.test(text) ? 'thai' : 'other' }; }
function queryFrom(text: string): string { return text.replace(/[#*_`>\-[\]()]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 10).join(' '); }
function evenly<T>(items: T[], count: number): T[] { if (count <= 0 || items.length === 0) return []; return Array.from({ length: Math.min(count, items.length) }, (_, i) => items[Math.floor(i * items.length / Math.min(count, items.length))]); }
function overlap(a: string[], b: string[]): number { const set = new Set(a); return round(b.filter((id) => set.has(id)).length / Math.max(1, Math.min(a.length, b.length))); }
function cosine(a: number[], b: number[]): number { const n = Math.min(a.length, b.length); let dot = 0, aa = 0, bb = 0; for (let i = 0; i < n; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; } return aa && bb ? dot / (Math.sqrt(aa) * Math.sqrt(bb)) : 0; }
function assertAligned(a: unknown[], b: unknown[], expected: number, label: string): void { if (a.length !== expected || b.length !== expected) throw new Error(`Mismatched ${label} embeddings: local=${a.length}, cloudflare=${b.length}, expected=${expected}`); }
function percentile(sorted: number[], p: number): number { return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))] ?? 0; }
function mean(values: number[]): number { return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length); }
function round(value: number): number { return Math.round(value * 10000) / 10000; }
function positive(value: number | undefined, fallback: number): number { return Number.isFinite(value ?? NaN) && (value as number) > 0 ? Math.floor(value as number) : fallback; }
function defaultReportDir(repoRoot = process.env.ORACLE_REPO_ROOT || process.cwd()): string { return path.join(repoRoot, 'ψ', 'memory', 'learnings'); }
function escapePipe(value: string): string { return value.replace(/\|/g, '\\|').slice(0, 80); }
