import { CloudflareAIEmbeddings } from '../src/vector/adapters/cloudflare-vectorize.ts';
import { OllamaEmbeddings } from '../src/vector/embeddings.ts';
import { runBgeM3DriftBenchmark, type BenchmarkConfig } from '../src/vector/drift-benchmark.ts';

const config: BenchmarkConfig = {
  dbPath: process.env.BGE_DRIFT_DB_PATH || process.env.ORACLE_DB_PATH,
  repoRoot: process.env.BGE_DRIFT_REPO_ROOT || process.env.ORACLE_REPO_ROOT || process.cwd(),
  reportDir: process.env.BGE_DRIFT_REPORT_DIR,
  sampleSize: intEnv('BGE_DRIFT_SAMPLE_SIZE', 100),
  queryCount: intEnv('BGE_DRIFT_QUERY_COUNT', 8),
  topK: intEnv('BGE_DRIFT_TOP_K', 10),
  queries: process.env.BGE_DRIFT_QUERIES?.split(/\n|\|\|/),
};

const local = new OllamaEmbeddings({
  model: process.env.BGE_DRIFT_LOCAL_MODEL || 'bge-m3',
  baseUrl: process.env.OLLAMA_BASE_URL || process.env.OLLAMA_HOST,
});
const cloudflare = hasCloudflareSecrets() ? new CloudflareAIEmbeddings({
  model: '@cf/baai/bge-m3',
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID || process.env.ACCOUNT_ID,
  apiToken: process.env.CLOUDFLARE_API_TOKEN,
}) : undefined;
const result = await runBgeM3DriftBenchmark(config, { local, cloudflare });
console.log(`status=${result.status}`);
console.log(`docs=${result.docs.length} queries=${result.queries.length}`);
if (result.metrics) {
  console.log(`meanDrift=${result.metrics.meanDrift} p95Drift=${result.metrics.p95Drift} overlap=${result.metrics.avgTopKOverlap} verdict=${result.metrics.verdict}`);
} else {
  console.log('cloudflare=skipped (missing CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_API_TOKEN; blocked on #2680)');
}
console.log(`report=${result.reportPath}`);

function hasCloudflareSecrets(): boolean {
  return Boolean((process.env.CLOUDFLARE_ACCOUNT_ID?.trim() || process.env.ACCOUNT_ID?.trim()) && process.env.CLOUDFLARE_API_TOKEN?.trim());
}
function intEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
