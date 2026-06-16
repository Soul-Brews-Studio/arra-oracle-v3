import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { runCli, type RunResult } from '../cli/_run.ts';

export const REPO_ROOT = new URL('../../', import.meta.url).pathname.replace(/\/$/, '');

type Spawned = ReturnType<typeof Bun.spawn>;
type VectorResponder = (url: URL) => unknown;

export interface SmokeEnv {
  root: string;
  home: string;
  dataDir: string;
  repoRoot: string;
  dbPath: string;
  env: Record<string, string>;
}

export interface SmokeServer extends SmokeEnv {
  baseUrl: string;
  process: Spawned;
  stdout: Promise<string>;
  stderr: Promise<string>;
  stop: () => Promise<void>;
}

interface VectorStub {
  url: string;
  requests: URL[];
  stop: () => Promise<void>;
}

export function createSmokeEnv(name: string): SmokeEnv {
  const root = mkdtempSync(join(tmpdir(), `arra-smoke-${name}-`));
  const home = join(root, 'home');
  const dataDir = join(root, 'data');
  const repoRoot = join(root, 'repo');
  mkdirSync(join(repoRoot, 'ψ'), { recursive: true });
  mkdirSync(home, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, 'oracle.db');
  return {
    root,
    home,
    dataDir,
    repoRoot,
    dbPath,
    env: {
      HOME: home,
      ORACLE_DATA_DIR: dataDir,
      ORACLE_DB_PATH: dbPath,
      ORACLE_REPO_ROOT: repoRoot,
      ORACLE_STORAGE_BACKEND: 'drizzle-sqlite',
      ORACLE_API_TOKEN: '',
      ARRA_API_TOKEN: '',
      ORACLE_MENU_GIST: '',
      ORACLE_MENU_GIST_URL: '',
      ORACLE_NAV_DISABLE: '',
      ORACLE_EMBEDDER: 'none',
    },
  };
}

export function writeOraclePlugin(home: string): void {
  const dir = join(home, '.oracle', 'plugins', 'smoke-orbit');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'plugin.json'),
    JSON.stringify({
      name: 'smoke-orbit',
      version: '0.1.0',
      entry: './index.ts',
      description: 'Smoke fixture plugin',
      menu: { label: 'Smoke Orbit', path: '/smoke-orbit', group: 'tools', order: 123 },
      server: { command: 'bun', args: ['index.ts'], healthPath: '/health', autostart: false },
    }, null, 2),
  );
  writeFileSync(join(dir, 'index.ts'), 'export default async () => ({ ok: true });\n');
}

export function writePsiMemory(repoRoot: string, body: string): string {
  const dir = join(repoRoot, 'ψ', 'memory', 'learnings');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'smoke-memory.md');
  writeFileSync(file, body);
  return file;
}

export async function startSmokeServer(options: {
  name: string;
  withPlugin?: boolean;
  vectorResponder?: VectorResponder;
}): Promise<SmokeServer> {
  const smoke = createSmokeEnv(options.name);
  if (options.withPlugin) writeOraclePlugin(smoke.home);
  const vector = options.vectorResponder ? startVectorStub(options.vectorResponder) : null;
  if (vector) smoke.env.VECTOR_URL = vector.url;

  const port = await freePort();
  const env = { ...process.env, ...smoke.env, ORACLE_PORT: String(port) };
  const proc = Bun.spawn(['bun', 'src/server.ts'], {
    cwd: REPO_ROOT,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = new Response(proc.stdout).text();
  const stderr = new Response(proc.stderr).text();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await waitForHealth(baseUrl, proc);
  } catch (error) {
    proc.kill();
    await proc.exited.catch(() => undefined);
    const logs = `${await stdout.catch(() => '')}\n${await stderr.catch(() => '')}`;
    await vector?.stop();
    rmSync(smoke.root, { recursive: true });
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${logs}`);
  }

  return {
    ...smoke,
    baseUrl,
    process: proc,
    stdout,
    stderr,
    stop: async () => {
      proc.kill('SIGTERM');
      const done = await Promise.race([proc.exited.catch(() => null), sleep(1500).then(() => null)]);
      if (done === null) {
        proc.kill('SIGKILL');
        await proc.exited.catch(() => undefined);
      }
      await vector?.stop();
      rmSync(smoke.root, { recursive: true });
    },
  };
}

export async function runSmokeCli(server: SmokeServer, args: string[]): Promise<RunResult> {
  return runCli(args, { ...server.env, ORACLE_API: server.baseUrl }, { cwd: REPO_ROOT });
}

export function logSmoke(label: string, data: unknown): void {
  console.log(`[smoke] ${label}: ${JSON.stringify(data)}`);
}

export function startVectorStub(responder: VectorResponder): VectorStub {
  const requests: URL[] = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      requests.push(url);
      if (url.pathname === '/api/search') return Response.json(responder(url));
      if (url.pathname === '/api/vector/health') {
        return Response.json({ status: 'ok', engines: [], checked_at: new Date().toISOString() });
      }
      return Response.json({ error: 'not found' }, { status: 404 });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    requests,
    stop: () => server.stop(true),
  };
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('failed to allocate port'));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForHealth(baseUrl: string, proc: Spawned): Promise<void> {
  let exited = false;
  proc.exited.then(() => { exited = true; }).catch(() => { exited = true; });
  const deadline = Date.now() + 10_000;
  let last = '';
  while (Date.now() < deadline) {
    if (exited) throw new Error('server exited before /api/health became ready');
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
      last = `HTTP ${res.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await sleep(150);
  }
  throw new Error(`server did not become healthy: ${last}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
