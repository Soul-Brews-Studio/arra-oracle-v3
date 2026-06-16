// HTTP contract tests — trace routes.
//
// Spawns a dedicated server with an isolated ORACLE_DATA_DIR and seeds trace
// rows directly into the same SQLite database used by the spawned server.
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import type { Subprocess } from "bun";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

const PORT = 47791;
const BASE_URL = `http://localhost:${PORT}`;
const SERVER_CWD = import.meta.dir.replace(/\/tests\/http\/traces$/, "");

let serverProcess: Subprocess | null = null;
let tmpDir: string;
let dbPath: string;

async function ping(): Promise<boolean> {
  try { return (await fetch(`${BASE_URL}/api/health`)).ok; } catch { return false; }
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "traces-http-"));
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

describe("Trace routes", () => {
  let traceA: string;
  let traceB: string;

  beforeAll(() => {
    traceA = randomUUID();
    traceB = randomUUID();
    const db = new Database(dbPath);
    try {
      const now = Date.now();
      const insert = db.prepare(`
        INSERT INTO trace_log (
          trace_id, query, query_type,
          found_files, found_commits, found_issues,
          found_retrospectives, found_learnings, found_resonance,
          file_count, commit_count, issue_count,
          depth, child_trace_ids,
          scope, agent_count, status,
          created_at, updated_at
        ) VALUES (?, ?, 'general', '[]', '[]', '[]', '[]', '[]', '[]', 0, 0, 0, 0, '[]', 'project', 1, 'raw', ?, ?)
      `);
      insert.run(traceA, "contract-test trace A", now, now);
      insert.run(traceB, "contract-test trace B", now, now);
    } finally {
      db.close();
    }
  });

  test("GET /api/traces lists traces", async () => {
    const res = await fetch(`${BASE_URL}/api/traces?limit=10`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(Array.isArray(data.traces)).toBe(true);
  });

  test("GET /api/traces/:id returns trace", async () => {
    const res = await fetch(`${BASE_URL}/api/traces/${traceA}`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.traceId).toBe(traceA);
  });

  test("GET /api/traces/:id missing returns 404", async () => {
    const res = await fetch(`${BASE_URL}/api/traces/nonexistent-id`);
    expect(res.status).toBe(404);
  });

  test("GET /api/traces/:id/chain returns chain object", async () => {
    const res = await fetch(`${BASE_URL}/api/traces/${traceA}/chain`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data).toHaveProperty("chain");
  });

  test("POST /api/traces/:id/distill stores an awakening", async () => {
    const res = await fetch(`${BASE_URL}/api/traces/${traceA}/distill`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ awakening: "Thor turns storm into research-grade dev context." }),
    });
    expect(res.ok).toBe(true);
    expect(await res.json()).toMatchObject({ success: true, status: "distilled" });

    const traceRes = await fetch(`${BASE_URL}/api/traces/${traceA}`);
    const trace = await traceRes.json();
    expect(trace.status).toBe("distilled");
    expect(trace.awakening).toContain("Thor turns storm");

    const chainRes = await fetch(`${BASE_URL}/api/traces/${traceA}/chain`);
    const chain = await chainRes.json();
    expect(chain).toMatchObject({ hasAwakening: true, awakeningTraceId: traceA });
  });

  test("POST /api/traces/:prevId/link without body returns 400", async () => {
    const res = await fetch(`${BASE_URL}/api/traces/${traceA}/link`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/traces/:prevId/link links prev→next", async () => {
    const res = await fetch(`${BASE_URL}/api/traces/${traceA}/link`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nextId: traceB }),
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  test("GET /api/traces/:id/linked-chain returns both traces after link", async () => {
    const res = await fetch(`${BASE_URL}/api/traces/${traceA}/linked-chain`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(Array.isArray(data.chain)).toBe(true);
    expect(data.chain.length).toBe(2);
    const ids = data.chain.map((t: any) => t.traceId);
    expect(ids).toEqual([traceA, traceB]);
  });

  test("DELETE /api/traces/:id/link without direction returns 400", async () => {
    const res = await fetch(`${BASE_URL}/api/traces/${traceA}/link`, { method: "DELETE" });
    expect(res.status).toBe(400);
  });

  test("DELETE /api/traces/:id/link?direction=next unlinks and chain clears", async () => {
    const res = await fetch(`${BASE_URL}/api/traces/${traceA}/link?direction=next`, {
      method: "DELETE",
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.success).toBe(true);

    const chainRes = await fetch(`${BASE_URL}/api/traces/${traceA}/linked-chain`);
    const chainData = await chainRes.json();
    expect(chainData.chain.length).toBe(1);
    expect(chainData.chain[0].traceId).toBe(traceA);
  });
});
