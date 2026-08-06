import { readFileSync } from 'node:fs';
import { createHttpSearcher, parseDatasetText, runHonestRecallBenchmark } from './honest-recall.ts';
import type { HonestRecallReport, MetricRow } from './honest-recall.ts';

export async function runCli(args: string[]): Promise<void> {
  const cli = parseArgs(args);
  const report = await runHonestRecallBenchmark({
    cases: parseDatasetText(readFileSync(cli.dataset, 'utf8')),
    topK: cli.topK,
    corpus: { label: cli.corpus, size: cli.corpusSize },
    mode: cli.mode,
    model: cli.model,
    searcher: createHttpSearcher(cli.baseUrl),
    outFile: cli.outFile,
    retrieveDepth: Number.isSafeInteger(cli.retrieveDepth) ? cli.retrieveDepth : undefined,
    rerank: cli.rerank ? { enabled: true, url: cli.rerankerUrl } : undefined,
  });
  printSummary(report);
}

function parseArgs(args: string[]) {
  const opts = new Map<string, string>();
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith('--')) continue;
    if (arg === '--rerank') opts.set('rerank', 'true');
    else { opts.set(arg.slice(2), args[i + 1] ?? ''); i += 1; }
  }
  return {
    dataset: required(opts, 'dataset'),
    corpus: opts.get('corpus') || 'oracle-hybrid-kb',
    corpusSize: Number(opts.get('corpus-size')),
    topK: Number(opts.get('top-k') ?? (opts.has('rerank') ? 3 : 10)),
    mode: cliMode(opts.get('mode') ?? 'hybrid'),
    model: opts.get('model') ?? 'multi',
    baseUrl: opts.get('base-url') ?? 'http://127.0.0.1:47778',
    outFile: opts.get('out') ?? 'benchmarks/out/honest-recall.json',
    rerank: opts.has('rerank'),
    rerankerUrl: opts.get('reranker-url'),
    retrieveDepth: Number(opts.get('retrieve-depth') ?? opts.get('candidate-pool') ?? NaN),
  };
}

function cliMode(value: string) {
  if (value === 'hybrid' || value === 'fts' || value === 'vector') return value;
  throw new Error('mode must be one of: hybrid, fts, vector');
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
