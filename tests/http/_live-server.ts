/**
 * A server owned by one test file: its own port, its own database, torn down after.
 *
 * `compare.test.ts` and `knowledge.test.ts` each carried a near-identical copy of this, and
 * both copies had the same defect — they began with `if (await isUp()) return;`, adopting
 * whatever was already listening and then seeding it through `POST /api/learn`. On a
 * developer machine that is the live Oracle: 616 test documents reached the real corpus
 * between 2026-05-03 and 2026-06-16, indexed, and ranking in real search results.
 *
 * In `knowledge.test.ts` the early `return` skipped **past** the temp data directory created
 * two lines below, so the isolation only ever applied on the path that did not need it.
 *
 * The rule this encodes: **a test never writes to a database it did not create.** An occupied
 * port is an error, not an invitation.
 */
import type { Subprocess } from 'bun';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dir, '../..');

export interface LiveServer {
  baseUrl: string;
  dataDir: string;
  stop(): void;
  post(route: string, body: unknown): Promise<Response>;
}

async function healthy(baseUrl: string): Promise<boolean> {
  try {
    return (await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
}

/**
 * Start a server this suite owns.
 *
 * @param port  must be unique per test file — sharing one is what raced `core.test.ts`
 *              against `compare.test.ts` and produced a mid-run 503 in CI.
 * @param label prefix for the temp data directory, so a leftover is traceable to its suite.
 */
export async function startOwnedServer(
  port: number,
  label: string,
  /** Extra env for suites that need more isolation than port + data dir. */
  extraEnv: Record<string, string> = {},
): Promise<LiveServer> {
  const baseUrl = `http://localhost:${port}`;

  if (await healthy(baseUrl)) {
    throw new Error(
      `Port ${port} is already in use. This suite must own its server — refusing to seed data into someone else's.`,
    );
  }

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`));
  const proc: Subprocess = Bun.spawn(['bun', 'run', 'src/server.ts'], {
    cwd: REPO_ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      ORACLE_PORT: String(port),
      ORACLE_DATA_DIR: dataDir,
      ORACLE_DB_PATH: path.join(dataDir, 'oracle.db'),
      // Also point the repo root at the temp dir so a spawned server cannot read or write
      // the developer's real ψ/ vault.
      ORACLE_REPO_ROOT: dataDir,
      ORACLE_CHROMA_TIMEOUT: '3000',
      ...extraEnv,
    },
  });

  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await healthy(baseUrl)) {
      return {
        baseUrl,
        dataDir,
        stop() {
          proc.kill();
          fs.rmSync(dataDir, { recursive: true, force: true });
        },
        post(route, body) {
          return fetch(`${baseUrl}${route}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
        },
      };
    }
    await Bun.sleep(500);
  }

  proc.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
  throw new Error(`Server on ${baseUrl} failed to become healthy within 15s`);
}
