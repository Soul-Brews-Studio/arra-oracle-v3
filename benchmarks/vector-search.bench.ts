import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { runBench, tempBenchDir } from './harness.ts';

const root = tempBenchDir('vector-search');
const dataDir = join(root, 'data');
const repoRoot = join(root, 'repo');
mkdirSync(repoRoot, { recursive: true });

const vectorStub = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== '/api/search') return Response.json({ error: 'not found' }, { status: 404 });
    return Response.json({
      results: [],
      total: 0,
      limit: Number(url.searchParams.get('limit') ?? 10),
      offset: Number(url.searchParams.get('offset') ?? 0),
      query: url.searchParams.get('q') ?? '',
    });
  },
});

process.env.HOME = root;
process.env.ORACLE_DATA_DIR = dataDir;
process.env.ORACLE_DB_PATH = join(dataDir, 'oracle.db');
process.env.ORACLE_REPO_ROOT = repoRoot;
process.env.ORACLE_STORAGE_BACKEND = 'drizzle-sqlite';
process.env.ORACLE_EMBEDDER = 'none';
process.env.VECTOR_URL = `http://127.0.0.1:${vectorStub.port}`;

const { vectorRoutes } = await import('../src/routes/vector/index.ts');
const { closeDb } = await import('../src/db/index.ts');
const originalLog = console.log;
const originalError = console.error;

try {
  await runBench('vector search GET /api/vector/search via VECTOR_URL', async () => {
    console.log = () => {};
    console.error = () => {};
    try {
      const res = await vectorRoutes.handle(new Request('http://bench/api/vector/search?q=oracle&limit=5'));
      const body = await res.json() as { query?: string; results?: unknown[] };
      if (res.status !== 200 || body.query !== 'oracle' || !Array.isArray(body.results)) {
        throw new Error('vector search failed');
      }
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
  }, { iterations: 200, warmup: 20 });
} finally {
  console.log = originalLog;
  console.error = originalError;
  closeDb();
  await vectorStub.stop(true);
  rmSync(root, { recursive: true, force: true });
}
