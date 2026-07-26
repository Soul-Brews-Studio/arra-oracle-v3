import { afterAll, expect, test } from 'bun:test';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer } from 'node:net';

let sidecar: ChildProcessWithoutNullStreams | undefined;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

async function waitForHealth(base: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) return;
      last = `HTTP ${res.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`sidecar did not become healthy: ${last}`);
}

/**
 * Everything the sidecar told us, for when it dies mid-test (#2905).
 *
 * The process is spawned with `stdio: 'pipe'`, which captures stdout and stderr into streams
 * that nothing read — so on failure the python traceback, the one artefact that would explain
 * the crash, was discarded. This test has failed intermittently in CI with ECONNRESET on
 * `/vectors/query` and the logs said nothing about why, which is most of the reason it was
 * misdiagnosed twice.
 */
const sidecarOutput = { stdout: '', stderr: '', exit: '' as string };

function attachDiagnostics(child: ChildProcessWithoutNullStreams): void {
  child.stdout?.on('data', (chunk) => { sidecarOutput.stdout += String(chunk); });
  child.stderr?.on('data', (chunk) => { sidecarOutput.stderr += String(chunk); });
  child.on('exit', (code, signal) => {
    sidecarOutput.exit = `exited early: code=${code ?? 'null'} signal=${signal ?? 'null'}`;
  });
}

function diagnostics(): string {
  const parts = [
    sidecarOutput.exit,
    sidecarOutput.stderr.trim() && `--- sidecar stderr ---\n${sidecarOutput.stderr.trim()}`,
    sidecarOutput.stdout.trim() && `--- sidecar stdout ---\n${sidecarOutput.stdout.trim()}`,
  ].filter(Boolean);
  return parts.length ? `\n${parts.join('\n')}` : '\n(sidecar produced no output)';
}

async function json(path: string, init?: RequestInit) {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch (error) {
    // Without this the CI log shows only "socket connection was closed unexpectedly".
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${init?.method ?? 'GET'} ${path} failed: ${reason}${diagnostics()}`);
  }
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} → HTTP ${res.status}${diagnostics()}`);
  return await res.json() as Record<string, any>;
}

afterAll(() => {
  sidecar?.kill('SIGTERM');
});

test('TurboVec sidecar reference speaks the vector proxy protocol', async () => {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  sidecar = spawn('python3', ['sidecar/turbovec/server.py', '--port', String(port), '--name', 'turbovec-test', '--backend', 'fallback'], {
    cwd: process.cwd(),
    stdio: 'pipe',
  });
  attachDiagnostics(sidecar);
  sidecar.on('error', (error) => { throw error; });
  await waitForHealth(base);

  expect(await json(`${base}/health`)).toMatchObject({
    status: 'ok',
    name: 'turbovec-test',
    protocol: 'vector-proxy-v1',
    backend: 'fallback',
  });
  expect(await json(`${base}/vectors/stats`)).toMatchObject({
    count: 0,
    name: 'turbovec-test',
    backend: 'fallback',
  });

  const docs = [
    { id: 'doc-a', document: 'oracle memory search', metadata: { type: 'learning' } },
    { id: 'doc-b', document: 'canvas worker app', metadata: { type: 'canvas' } },
  ];
  expect(await json(`${base}/vectors/add`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ documents: docs }),
  })).toMatchObject({ success: true, count: 2 });

  const query = await json(`${base}/vectors/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'oracle', limit: 5, where: { type: 'learning' } }),
  });
  expect(query.ids).toEqual(['doc-a']);
  expect(query.metadatas[0]).toMatchObject({ id: 'doc-a', type: 'learning' });

  const byId = await json(`${base}/vectors/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: '', limit: 5, where: { id: 'doc-b' } }),
  });
  expect(byId.ids).toEqual(['doc-b']);

  expect(await json(`${base}/vectors/collection`, { method: 'DELETE' })).toMatchObject({ success: true });
  expect(await json(`${base}/vectors/stats`)).toMatchObject({ count: 0 });
}, 10_000);
