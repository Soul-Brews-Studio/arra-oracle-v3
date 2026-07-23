// HTTP contract tests for the ARRA_API_TOKEN bearer-auth guard (src/http/auth.ts).
// Isolated port + temp data dir so this doesn't collide with other http/*.test.ts servers.
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import type { Subprocess } from "bun";
import fs from "fs";
import os from "os";
import path from "path";

const PORT = 47788;
const BASE_URL = `http://localhost:${PORT}`;
const TOKEN = "contract-test-bearer-token";

let serverProcess: Subprocess | null = null;
let dataDir = "";

async function waitForServer(maxAttempts = 30): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await fetch(`${BASE_URL}/api/health`);
      return true; // any response (even 401) means the server is up
    } catch { /* not ready */ }
    await Bun.sleep(500);
  }
  return false;
}

describe("HTTP contract: ARRA_API_TOKEN bearer auth", () => {
  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oracle-http-token-test-"));
    const cwd = import.meta.dir.replace(/\/tests\/http$/, "");
    serverProcess = Bun.spawn(["bun", "run", "src/server.ts"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        ORACLE_PORT: String(PORT),
        ORACLE_DATA_DIR: dataDir,
        ORACLE_CHROMA_TIMEOUT: "3000",
        ARRA_API_TOKEN: TOKEN,
      },
    });
    const ready = await waitForServer();
    if (!ready) throw new Error(`Server failed to start on ${PORT}`);
  }, 30_000);

  afterAll(() => {
    if (serverProcess) serverProcess.kill();
    if (dataDir && fs.existsSync(dataDir)) {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("GET /api/stats with no Authorization header returns 401", async () => {
    const res = await fetch(`${BASE_URL}/api/stats`);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(typeof data.error).toBe("string");
  });

  test("GET /api/stats with wrong token returns 401", async () => {
    const res = await fetch(`${BASE_URL}/api/stats`, {
      headers: { Authorization: "Bearer wrong-token" },
    });
    expect(res.status).toBe(401);
  });

  test("GET /api/stats with correct token returns 200", async () => {
    const res = await fetch(`${BASE_URL}/api/stats`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(typeof data.total).toBe("number");
  }, 15_000);
});
