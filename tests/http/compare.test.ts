/**
 * HTTP Contract Tests — GET /api/compare
 *
 * Phase 2 of ui-vector#5: fan-out search across multiple embedding models,
 * single round-trip with pre-computed agreement metrics.
 *
 * Pattern mirrors tests/http/knowledge.test.ts (subprocess + fetch).
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import type { Subprocess } from "bun";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * Its own port and its own data directory.
 *
 * This used to point at **47778 — the developer default** — and begin with
 * `if (await isUp()) return;`, adopting whatever was listening and then POSTing to
 * /api/learn. 168 `compare-http-test-*` documents reached the live corpus that way between
 * 2026-05-03 and 2026-06-16. It also raced `core.test.ts` on the same port, which is how CI
 * saw a healthy /api/health and then a 503 mid-run.
 */
const PORT = 47792;
const BASE_URL = `http://localhost:${PORT}`;
let dataDir = "";
const SEED_TAG = `compare-http-test-${Date.now()}`;
const JSON_HEADERS = { "Content-Type": "application/json" };
let serverProcess: Subprocess | null = null;

const isUp = async () => {
  try { return (await fetch(`${BASE_URL}/api/health`)).ok; } catch { return false; }
};
const waitUp = async (n = 30) => {
  for (let i = 0; i < n; i++) { if (await isUp()) return true; await Bun.sleep(500); }
  return false;
};
const post = (url: string, body: unknown) =>
  fetch(`${BASE_URL}${url}`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });

async function seedLearn(pattern: string, concepts: string[] = []) {
  const res = await post("/api/learn", { pattern, source: SEED_TAG, concepts: [SEED_TAG, ...concepts] });
  if (!res.ok) throw new Error(`seed failed (${res.status}): ${await res.text()}`);
  return res.json();
}

describe("HTTP Contract — GET /api/compare", () => {
  beforeAll(async () => {
    if (await isUp()) {
      throw new Error(
        `Port ${PORT} is already in use. This suite must own its server — refusing to seed data into someone else's.`,
      );
    }
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "compare-http-"));
    serverProcess = Bun.spawn(["bun", "run", "src/server.ts"], {
      cwd: path.resolve(import.meta.dir, "../.."),
      stdout: "pipe", stderr: "pipe",
      env: {
        ...process.env,
        ORACLE_PORT: String(PORT),
        ORACLE_DATA_DIR: dataDir,
        ORACLE_DB_PATH: path.join(dataDir, "oracle.db"),
        ORACLE_CHROMA_TIMEOUT: "3000",
      },
    });
    if (!(await waitUp())) throw new Error("Server failed to start within 15s");
    // Best-effort seed so some model columns have real results
    try { await seedLearn(`${SEED_TAG} — alpha about compare endpoint`); } catch { /* ignore */ }
    try { await seedLearn(`${SEED_TAG} — beta on compare agreement`); } catch { /* ignore */ }
  }, 60_000);
  afterAll(() => {
    if (serverProcess) serverProcess.kill();
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test("rejects missing query param", async () => {
    const res = await fetch(`${BASE_URL}/api/compare`);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/q/);
  });

  test("rejects query empty after sanitize", async () => {
    const res = await fetch(`${BASE_URL}/api/compare?q=${encodeURIComponent("<script></script>")}`);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/empty|invalid/i);
  });

  test("default (no models param) uses all enabled models", async () => {
    const res = await fetch(`${BASE_URL}/api/compare?q=${encodeURIComponent(SEED_TAG)}&limit=5`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.query).toBe(SEED_TAG);
    expect(Array.isArray(data.models)).toBe(true);
    expect(data.models.length).toBeGreaterThan(0);
    expect(typeof data.byModel).toBe("object");
    expect(data.byModel).not.toBeNull();
    // Every listed model must have a byModel entry
    for (const m of data.models) expect(data.byModel).toHaveProperty(m);
    // Agreement block always present
    expect(data.agreement).toBeDefined();
    expect(typeof data.agreement.top1).toBe("number");
    expect(typeof data.agreement.top5_jaccard).toBe("number");
    expect(typeof data.agreement.avg_rank_shift).toBe("number");
    expect(Array.isArray(data.agreement.shared_ids)).toBe(true);
  }, 60_000);

  test("explicit models param — successful columns include latency_ms", async () => {
    const res = await fetch(`${BASE_URL}/api/compare?q=${encodeURIComponent(SEED_TAG)}&models=bge-m3,nomic&limit=3`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.models).toEqual(["bge-m3", "nomic"]);
    for (const m of ["bge-m3", "nomic"]) {
      const entry = data.byModel[m];
      expect(entry).toBeDefined();
      if ("error" in entry) {
        expect(typeof entry.error).toBe("string");
      } else {
        expect(Array.isArray(entry.results)).toBe(true);
        expect(typeof entry.latency_ms).toBe("number");
        expect(entry.results.length).toBeLessThanOrEqual(3);
      }
    }
  }, 60_000);

  test("unknown model names are filtered out, known ones remain", async () => {
    const res = await fetch(`${BASE_URL}/api/compare?q=${encodeURIComponent(SEED_TAG)}&models=bge-m3,bogus-model-xyz&limit=2`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.models).toEqual(["bge-m3"]);
    expect(data.byModel).toHaveProperty("bge-m3");
    expect(data.byModel).not.toHaveProperty("bogus-model-xyz");
  }, 60_000);

  test("no models enabled (all unknown) → empty byModel + zero agreement", async () => {
    const res = await fetch(`${BASE_URL}/api/compare?q=${encodeURIComponent(SEED_TAG)}&models=none1,none2`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.models).toEqual([]);
    expect(Object.keys(data.byModel).length).toBe(0);
    expect(data.agreement.top1).toBe(0);
    expect(data.agreement.top5_jaccard).toBe(0);
    expect(data.agreement.avg_rank_shift).toBe(0);
    expect(data.agreement.shared_ids).toEqual([]);
  });

  test("per-model failure is captured, other columns stay intact", async () => {
    // qwen3 typically isn't loaded in CI / dev → errors surface as a per-model
    // `error` string while bge-m3 and nomic succeed. We accept either shape.
    const res = await fetch(`${BASE_URL}/api/compare?q=${encodeURIComponent(SEED_TAG)}&models=bge-m3,qwen3&limit=3`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.models).toEqual(["bge-m3", "qwen3"]);
    expect(data.byModel["bge-m3"]).toBeDefined();
    expect(data.byModel["qwen3"]).toBeDefined();
    // If qwen3 errored, agreement block must still compute (from surviving models)
    expect(data.agreement).toBeDefined();
  }, 60_000);

  test("limit is clamped to [1,100]", async () => {
    const res = await fetch(`${BASE_URL}/api/compare?q=${encodeURIComponent(SEED_TAG)}&models=bge-m3&limit=9999`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    const entry = data.byModel["bge-m3"];
    if (entry && "results" in entry) {
      expect(entry.results.length).toBeLessThanOrEqual(100);
    }
  }, 60_000);
});
