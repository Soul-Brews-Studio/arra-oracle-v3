import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const ROOT = process.cwd();
let proc: Bun.Subprocess | undefined;

async function waitFor(base: string, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(`${base}/api/health`); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timed out waiting for ${base}`);
}

async function startServer(token?: string) {
  const port = 52000 + Math.floor(Math.random() * 1000);
  const dataDir = mkdtempSync(join(tmpdir(), 'arra-api-token-data-'));
  const repoRoot = mkdtempSync(join(tmpdir(), 'arra-api-token-repo-'));
  mkdirSync(join(repoRoot, 'ψ'), { recursive: true });
  proc = Bun.spawn(['bun', 'src/server.ts'], {
    cwd: ROOT,
    stdout: 'ignore',
    stderr: 'ignore',
    env: {
      ...process.env,
      ORACLE_PORT: String(port),
      ORACLE_DATA_DIR: dataDir,
      ORACLE_DB_PATH: join(dataDir, 'oracle.db'),
      ORACLE_REPO_ROOT: repoRoot,
      ARRA_API_TOKEN: token ?? '',
      VECTOR_URL: '',
      MAW_JS_URL: 'http://127.0.0.1:1',
    },
  });
  const base = `http://127.0.0.1:${port}`;
  await waitFor(base);
  return base;
}

async function postLearn(base: string, init: RequestInit = {}) {
  return fetch(`${base}/api/learn`, {
    ...init,
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(init.headers as Record<string, string> | undefined) },
    body: JSON.stringify({ pattern: 'api token auth integration sentinel', source: 'test' }),
  });
}

afterEach(() => { proc?.kill(); proc = undefined; });

describe('ARRA_API_TOKEN HTTP auth', () => {
  test('unset token keeps /api/learn open', async () => {
    const base = await startServer();
    const res = await postLearn(base);
    expect(res.status).not.toBe(401);
    expect(res.ok).toBe(true);
  });

  test('set token gates /api/learn while health stays open and federation stays absent', async () => {
    const base = await startServer('secret');
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
    expect((await fetch(`${base}/info`)).status).toBe(404);
    expect((await fetch(`${base}/api/identity`)).status).toBe(401);
    expect((await fetch(`${base}/api/peer/feed`)).status).toBe(401);

    expect((await fetch(`${base}/api/search?q=sentinel`)).status).toBe(401);

    const denied = await postLearn(base);
    expect(denied.status).toBe(401);
    expect(await denied.json()).toMatchObject({ error: 'api_auth_required' });

    const allowed = await postLearn(base, { headers: { authorization: 'Bearer secret' } });
    expect(allowed.status).toBe(200);
  });
});
