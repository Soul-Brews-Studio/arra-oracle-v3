/**
 * Shared server fixture — spawn src/server.ts on demand, reuse per test worker.
 * Parallel CLI tests get isolated ports so one file cannot stop another's server.
 */
import type { Subprocess } from "bun";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

export let BASE_URL = process.env.ORACLE_API || "http://127.0.0.1:47778";

let serverProcess: Subprocess | null = null;
let users = 0;
let root: string | null = null;

async function isServerRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForServer(maxAttempts = 30): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    if (await isServerRunning()) return true;
    await Bun.sleep(500);
  }
  return false;
}

const REPO_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");

export async function ensureServer(): Promise<void> {
  users += 1;
  if (serverProcess && await isServerRunning()) return;
  const port = await freePort();
  root = mkdtempSync(join(tmpdir(), "arra-cli-server-"));
  const dataDir = join(root, "data");
  const repoRoot = join(root, "repo");
  mkdirSync(dataDir); mkdirSync(repoRoot);
  BASE_URL = `http://127.0.0.1:${port}`;
  process.env.ORACLE_API = BASE_URL;
  serverProcess = Bun.spawn(["bun", "run", "src/server.ts"], {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      ORACLE_API: BASE_URL,
      ORACLE_PORT: String(port),
      ORACLE_DATA_DIR: dataDir,
      ORACLE_DB_PATH: join(dataDir, "oracle.db"),
      ORACLE_REPO_ROOT: repoRoot,
      ORACLE_CHROMA_TIMEOUT: "3000",
      ARRA_SCOUT_ANNOUNCE: "0",
    },
  });
  const ready = await waitForServer();
  if (!ready) {
    const stderr = await new Response(serverProcess.stderr).text().catch(() => "");
    stopServer(true);
    throw new Error(`Server failed to start for tests/cli/\n${stderr}`);
  }
}

export function stopServer(force = false): void {
  users = force ? 0 : Math.max(0, users - 1);
  if (users > 0 || !serverProcess) return;
  serverProcess.kill();
  serverProcess = null;
  if (root) rmSync(root, { recursive: true, force: true });
  root = null;
}

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("failed to allocate port"));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}
