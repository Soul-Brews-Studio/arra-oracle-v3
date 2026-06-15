#!/usr/bin/env bun
/**
 * Export the Elysia /api/docs/json spec to docs/openapi.json.
 *
 * Spawns `bun src/server.ts` on a scratch port, polls until /health
 * responds, fetches /api/docs/json, writes the file, then kills the
 * subprocess. Exits non-zero on any failure.
 *
 *   bun scripts/export-openapi.ts
 *   bun scripts/export-openapi.ts --port 48900 --out docs/openapi.json
 */

import { spawn } from 'bun';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const args = parseArgs(process.argv.slice(2));
const PORT = args.port ?? '48900';
const OUT = resolve(args.out ?? 'docs/openapi.json');
const BOOT_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 200;

const scratch = await mkdtemp(join(tmpdir(), 'arra-openapi-'));
const homeDir = join(scratch, 'home');
const dataDir = join(scratch, 'data');
const repoRoot = join(scratch, 'repo');
await Promise.all([
  mkdir(homeDir, { recursive: true }),
  mkdir(dataDir, { recursive: true }),
  mkdir(repoRoot, { recursive: true }),
]);

const child = spawn({
  cmd: ['bun', 'src/server.ts'],
  env: {
    ...process.env,
    HOME: homeDir,
    ORACLE_PORT: PORT,
    ORACLE_DATA_DIR: dataDir,
    ORACLE_DB_PATH: join(dataDir, 'oracle.db'),
    ORACLE_REPO_ROOT: repoRoot,
    ARRA_SCOUT_ANNOUNCE: '0',
    ORACLE_EMBEDDER: 'none',
    NODE_ENV: 'development',
  },
  stdout: 'pipe',
  stderr: 'pipe',
});

const shutdown = async (code: number): Promise<never> => {
  try {
    child.kill('SIGTERM');
    await Promise.race([
      child.exited,
      new Promise((r) => setTimeout(r, 3000)),
    ]);
    if (!child.killed) child.kill('SIGKILL');
  } catch {}
  await rm(scratch, { recursive: true }).catch(() => undefined);
  process.exit(code);
};

process.on('SIGINT', () => shutdown(130));
process.on('SIGTERM', () => shutdown(143));

try {
  await waitForServer(`http://127.0.0.1:${PORT}/`, BOOT_TIMEOUT_MS);

  const res = await fetch(`http://127.0.0.1:${PORT}/api/docs/json`);
  if (!res.ok) throw new Error(`fetch /api/docs/json failed: ${res.status}`);
  const spec = await res.json();

  validateOpenAPI3(spec);

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(spec, null, 2) + '\n', 'utf8');

  console.log(`✓ wrote ${OUT}`);
  console.log(`  openapi: ${spec.openapi}`);
  console.log(`  title:   ${spec.info?.title}`);
  console.log(`  version: ${spec.info?.version}`);
  console.log(`  paths:   ${Object.keys(spec.paths ?? {}).length}`);

  await shutdown(0);
} catch (err) {
  console.error('✗ export-openapi failed:', err instanceof Error ? err.message : err);
  await shutdown(1);
}

function parseArgs(argv: string[]): { port?: string; out?: string } {
  const out: { port?: string; out?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') out.port = argv[++i];
    else if (a === '--out') out.out = argv[++i];
  }
  return out;
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`server did not become ready on ${url} within ${timeoutMs}ms`);
}

function validateOpenAPI3(spec: any): void {
  if (!spec || typeof spec !== 'object') throw new Error('spec is not an object');
  if (typeof spec.openapi !== 'string' || !spec.openapi.startsWith('3.'))
    throw new Error(`openapi field must start with "3.", got ${JSON.stringify(spec.openapi)}`);
  if (!spec.info || typeof spec.info.title !== 'string' || typeof spec.info.version !== 'string')
    throw new Error('info.title and info.version are required');
  if (!spec.paths || typeof spec.paths !== 'object')
    throw new Error('paths object is required');
}
