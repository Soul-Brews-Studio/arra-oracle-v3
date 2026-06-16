// HTTP contract tests — forum and schedule routes.
//
// Spawns a dedicated server with an isolated ORACLE_DATA_DIR so this file is
// not affected by env mutations from other test files (e.g. files-plugins)
// or by a pre-existing dev server on the default port.
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import type { Subprocess } from "bun";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const PORT = 47790;
const BASE_URL = `http://localhost:${PORT}`;
const SERVER_CWD = import.meta.dir.replace(/\/tests\/http$/, "");

let serverProcess: Subprocess | null = null;
let tmpDir: string;
let dbPath: string;

async function ping(): Promise<boolean> {
  try { return (await fetch(`${BASE_URL}/api/health`)).ok; } catch { return false; }
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "forum-traces-"));
  dbPath = join(tmpDir, "oracle.db");
  serverProcess = Bun.spawn(["bun", "run", "src/server.ts"], {
    cwd: SERVER_CWD,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      ORACLE_CHROMA_TIMEOUT: "3000",
      ORACLE_DATA_DIR: tmpDir,
      ORACLE_DB_PATH: dbPath,
      ORACLE_REPO_ROOT: tmpDir,
      ORACLE_PORT: String(PORT),
    },
  });
  for (let i = 0; i < 30; i++) { if (await ping()) return; await Bun.sleep(500); }
  throw new Error("Server failed to start within 15s");
}, 30_000);

afterAll(() => {
  if (serverProcess) serverProcess.kill();
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe("Forum routes", () => {
  let createdThreadId: number | null = null;

  test("POST /api/thread creates thread", async () => {
    const res = await fetch(`${BASE_URL}/api/thread`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "contract-test seed message",
        title: "contract-test thread",
        role: "human",
      }),
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(typeof data.thread_id).toBe("number");
    createdThreadId = data.thread_id;
  }, 30_000);

  test("POST /api/thread without message is rejected", async () => {
    const res = await fetch(`${BASE_URL}/api/thread`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect([400, 422]).toContain(res.status);
  });

  test("GET /api/thread/:id returns thread with messages", async () => {
    expect(createdThreadId).not.toBeNull();
    const res = await fetch(`${BASE_URL}/api/thread/${createdThreadId}`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.thread.id).toBe(createdThreadId);
    expect(Array.isArray(data.messages)).toBe(true);
    expect(data.messages.length).toBeGreaterThan(0);
  });

  test("GET /api/thread/:id with invalid id returns 400", async () => {
    const res = await fetch(`${BASE_URL}/api/thread/not-a-number`);
    expect(res.status).toBe(400);
  });

  test("GET /api/thread/:id with missing id returns 404", async () => {
    const res = await fetch(`${BASE_URL}/api/thread/99999999`);
    expect(res.status).toBe(404);
  });

  test("PATCH /api/thread/:id/status rejects non-string status", async () => {
    expect(createdThreadId).not.toBeNull();
    const res = await fetch(`${BASE_URL}/api/thread/${createdThreadId}/status`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: 123 }),
    });
    expect(res.status).toBe(422);
  });

  test("PATCH /api/thread/:id/status updates status", async () => {
    expect(createdThreadId).not.toBeNull();
    const res = await fetch(`${BASE_URL}/api/thread/${createdThreadId}/status`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "closed" }),
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.status).toBe("closed");
  });

  test("GET /api/threads lists threads with count and pagination", async () => {
    const res = await fetch(`${BASE_URL}/api/threads?limit=5&offset=0`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(Array.isArray(data.threads)).toBe(true);
    expect(typeof data.total).toBe("number");
    expect(data.threads.length).toBeLessThanOrEqual(5);
  });

  test("GET /api/threads?status=closed filters", async () => {
    const res = await fetch(`${BASE_URL}/api/threads?status=closed`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.threads.some((t: any) => t.id === createdThreadId)).toBe(true);
  });
});


describe("Schedule routes", () => {
  let createdEventId: number | null = null;

  test("POST /api/schedule adds event", async () => {
    const res = await fetch(`${BASE_URL}/api/schedule`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        date: "2099-01-01",
        event: "contract-test event",
        time: "10:00",
      }),
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(typeof data.id).toBe("number");
    createdEventId = data.id;
  });

  test("POST /api/schedule rejects missing event", async () => {
    const res = await fetch(`${BASE_URL}/api/schedule`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ date: "2099-01-01" }),
    });
    expect(res.status).toBe(422);
  });

  test("GET /api/schedule lists events", async () => {
    const res = await fetch(`${BASE_URL}/api/schedule?status=all&limit=50`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(typeof data).toBe("object");
  });

  test("PATCH /api/schedule/:id rejects invalid status", async () => {
    expect(createdEventId).not.toBeNull();
    const res = await fetch(`${BASE_URL}/api/schedule/${createdEventId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "sideways" }),
    });
    expect(res.status).toBe(422);
  });

  test("PATCH /api/schedule/:id updates status", async () => {
    expect(createdEventId).not.toBeNull();
    const res = await fetch(`${BASE_URL}/api/schedule/${createdEventId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "done" }),
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.id).toBe(createdEventId);
  });

  test("GET /api/schedule/md returns markdown text", async () => {
    const res = await fetch(`${BASE_URL}/api/schedule/md`);
    expect([200, 404]).toContain(res.status);
    const text = await res.text();
    expect(typeof text).toBe("string");
  });
});
