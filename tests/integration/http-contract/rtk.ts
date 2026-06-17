import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import {
  createSmokeEnv,
  removeSmokeEnv,
  REPO_ROOT,
  writeOraclePlugin,
  type SmokeEnv,
} from '../../smoke/_helpers.ts';

export type JsonRecord = Record<string, unknown>;
type Spawned = ReturnType<typeof Bun.spawn>;

export interface ContractServer extends SmokeEnv {
  baseUrl: string;
  process: Spawned;
  stdout: Promise<string>;
  stderr: Promise<string>;
  stop: () => Promise<void>;
}

export interface ContractServerOptions {
  name: string;
  withPlugin?: boolean;
  prepareEnv?: (env: SmokeEnv) => void;
}

export function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

export async function fetchJson(server: ContractServer, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('accept', headers.get('accept') ?? 'application/json');
  const response = await fetch(`${server.baseUrl}${path}`, { ...init, headers });
  const text = await response.text();
  const body = text ? JSON.parse(text) as unknown : {};
  return { response, body };
}

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function writeFakeGhq(env: SmokeEnv, repo = 'contract/vault'): void {
  const ghqRoot = join(env.root, 'ghq');
  const binDir = join(env.root, 'bin');
  const vaultRepo = join(ghqRoot, 'github.com', 'contract', 'vault');
  const sourceRepo = join(ghqRoot, 'github.com', 'contract', 'source');
  mkdirSync(join(sourceRepo, 'ψ', 'memory', 'learnings'), { recursive: true });
  mkdirSync(vaultRepo, { recursive: true });
  writeFileSync(join(sourceRepo, 'ψ', 'memory', 'learnings', 'contract.md'), '# Contract vault fixture\n');
  mkdirSync(binDir, { recursive: true });
  const script = `#!/bin/sh
if [ "$1" = "root" ]; then echo "${ghqRoot}"; exit 0; fi
if [ "$1" = "list" ] && [ "$2" = "-p" ] && [ "$3" = "${repo}" ]; then echo "${vaultRepo}"; exit 0; fi
if [ "$1" = "list" ] && [ "$2" = "-p" ]; then printf '%s\n%s\n' "${sourceRepo}" "${vaultRepo}"; exit 0; fi
exit 1
`;
  const ghqPath = join(binDir, 'ghq');
  writeFileSync(ghqPath, script);
  chmodSync(ghqPath, 0o755);
  env.env.PATH = `${binDir}:${process.env.PATH ?? ''}`;
}

export function setContractSetting(server: ContractServer, key: string, value: string | null): void {
  const db = new Database(server.dbPath);
  try {
    db.query('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at')
      .run(key, value, Date.now());
  } finally {
    db.close();
  }
}

export async function startHttpContractServer(options: ContractServerOptions): Promise<ContractServer> {
  const smoke = createSmokeEnv(options.name);
  if (options.withPlugin) writeOraclePlugin(smoke.home);
  Object.assign(smoke.env, {
    ARRA_PLUGIN_HOT_RELOAD: '0',
    MAW_JS_URL: 'http://127.0.0.1:1',
    ORACLE_CHROMA_TIMEOUT: '1000',
    ORACLE_FILE_WATCHER: '0',
    ORACLE_TOOL_GROUPS_HOT_RELOAD: '0',
    ORACLE_VECTOR_HEALTH_TIMEOUT: '1000',
    VECTOR_URL: '',
  });
  options.prepareEnv?.(smoke);

  const port = await freePort();
  const env = { ...process.env, ...smoke.env, ORACLE_PORT: String(port) };
  const proc = Bun.spawn(['bun', 'src/server.ts'], { cwd: REPO_ROOT, env, stdout: 'pipe', stderr: 'pipe' });
  const stdout = new Response(proc.stdout).text();
  const stderr = new Response(proc.stderr).text();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await waitForHealth(baseUrl, proc);
  } catch (error) {
    proc.kill();
    await proc.exited.catch(() => undefined);
    removeSmokeEnv(smoke.root);
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${await stdout}\n${await stderr}`);
  }

  return { ...smoke, baseUrl, process: proc, stdout, stderr, stop: () => stopServer(proc, smoke.root, stdout, stderr) };
}

async function stopServer(proc: Spawned, root: string, stdout: Promise<string>, stderr: Promise<string>): Promise<void> {
  proc.kill('SIGTERM');
  const done = await Promise.race([proc.exited.catch(() => null), sleep(1500).then(() => 'timeout' as const)]);
  if (done === 'timeout') {
    proc.kill('SIGKILL');
    await proc.exited.catch(() => undefined);
  }
  await Promise.all([stdout.catch(() => ''), stderr.catch(() => '')]);
  removeSmokeEnv(root);
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('failed to allocate port'));
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForHealth(baseUrl: string, proc: Spawned): Promise<void> {
  let exited = false;
  proc.exited.then(() => { exited = true; }).catch(() => { exited = true; });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (exited) throw new Error('server exited before health check passed');
    try { if ((await fetch(`${baseUrl}/api/health`)).ok) return; } catch {}
    await sleep(150);
  }
  throw new Error('server did not become healthy');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
