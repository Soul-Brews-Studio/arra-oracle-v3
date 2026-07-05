import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';

type RunOptions = { cwd?: string; env?: Record<string, string | undefined>; timeoutMs?: number; allowFailure?: boolean };
type RunResult = { exitCode: number; stdout: string; stderr: string };

export async function smokeArraMine(repoRoot: string, scratch: string) {
  const notes = join(scratch, 'mine-notes');
  const dbPath = join(scratch, 'mine.db');
  mkdirSync(join(notes, 'ops'), { recursive: true });
  writeFileSync(join(notes, 'ops', 'deploy.md'), '# Deploy\n\nRollback checklist and deploy notes.');
  const result = await runProcess(['bun', 'cli/src/cli.ts', 'mine', notes, '--db-path', dbPath], {
    cwd: repoRoot,
    env: { ...process.env, ORACLE_EMBEDDER: 'none', ORACLE_REPO_ROOT: repoRoot },
    timeoutMs: 30_000,
  });
  const { createDatabase, oracleDocuments } = await import('../../src/db/index.ts');
  const { db, storage } = createDatabase(dbPath);
  try {
    const rows = db.select().from(oracleDocuments).where(eq(oracleDocuments.createdBy, 'mine')).all();
    return { stdout: result.stdout, rows };
  } finally { storage.close(); }
}

export async function smokeDockerHeroPath(repoRoot: string, scratch: string) {
  const suffix = `${process.pid}-${Date.now()}`;
  const image = `arra-readme-claims:${suffix}`;
  const name = `arra-readme-claims-${suffix}`;
  const dataDir = join(scratch, `docker-data-${suffix}`);
  mkdirSync(dataDir, { recursive: true });
  const port = await freePort();
  let container = '';
  try {
    await runProcess(['docker', 'build', '--quiet', '--target', 'http-server', '-t', image, '.'], {
      cwd: repoRoot,
      timeoutMs: 180_000,
    });
    const user = dockerUserArgs();
    const run = await runProcess([
      'docker', 'run', '-d', '--name', name, ...user,
      '-p', `127.0.0.1:${port}:47778`, '-v', `${dataDir}:/data`,
      '-e', 'ORACLE_FILE_WATCHER=0', '-e', 'ORACLE_EMBEDDER=none',
      '-e', 'ORACLE_GATEWAY_HOT_RELOAD=0', '-e', 'VECTOR_URL=', image,
    ], { timeoutMs: 30_000 });
    container = run.stdout.trim();
    return await waitForHealth(port, container);
  } finally {
    if (container) await runProcess(['docker', 'rm', '-f', container], { allowFailure: true });
    await runProcess(['docker', 'rmi', '-f', image], { allowFailure: true });
  }
}

async function waitForHealth(port: number, container: string): Promise<Record<string, any>> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return await response.json() as Record<string, any>;
    } catch {}
    await Bun.sleep(500);
  }
  const logs = await runProcess(['docker', 'logs', container], { allowFailure: true });
  throw new Error(`Docker HTTP image did not serve /api/health\n${logs.stdout}${logs.stderr}`);
}

function dockerUserArgs(): string[] {
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  return uid === undefined || gid === undefined ? [] : ['--user', `${uid}:${gid}`];
}

async function runProcess(command: string[], options: RunOptions = {}): Promise<RunResult> {
  const proc = Bun.spawn(command, {
    cwd: options.cwd,
    env: options.env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const done = Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]) as Promise<[number, string, string]>;
  const timed = Bun.sleep(options.timeoutMs ?? 60_000).then(() => {
    proc.kill('SIGKILL');
    throw new Error(`timed out: ${command.join(' ')}`);
  });
  const [exitCode, stdout, stderr] = await Promise.race([done, timed]);
  if (exitCode !== 0 && !options.allowFailure) {
    throw new Error(`${command.join(' ')} exited ${exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }
  return { exitCode, stdout, stderr };
}

function freePort(): Promise<number> {
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
