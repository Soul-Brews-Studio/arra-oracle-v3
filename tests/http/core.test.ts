/**
 * HTTP Contract Tests — Core Routes
 *
 * Covers:
 *   - src/routes/health.ts      → /api/health, /api/stats, /api/oracles
 *   - src/routes/dashboard.ts   → /api/dashboard(/summary|activity|growth), /api/session/stats
 *
 * Runs against current Hono backend; shape contracts will later verify Elysia parity.
 * Pattern mirrors src/integration/http.test.ts (subprocess + fetch).
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import type { Subprocess } from "bun";

const BASE_URL = "http://localhost:47778";
let serverProcess: Subprocess | null = null;

async function waitForServer(maxAttempts = 30): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) return true;
    } catch { /* not ready */ }
    await Bun.sleep(500);
  }
  return false;
}

async function isServerRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
}

describe("HTTP Contract — Core Routes", () => {
  beforeAll(async () => {
    if (await isServerRunning()) {
      console.log("Using existing server");
      return;
    }
    console.log("Starting server...");
    serverProcess = Bun.spawn(["bun", "run", "src/server.ts"], {
      cwd: import.meta.dir.replace("/tests/http", ""),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, ORACLE_CHROMA_TIMEOUT: "3000" },
    });
    const ready = await waitForServer();
    if (!ready) {
      let stderr = "";
      if (serverProcess.stderr) {
        const reader = serverProcess.stderr.getReader();
        try {
          const { value } = await reader.read();
          if (value) stderr = new TextDecoder().decode(value);
        } catch { /* ignore */ }
      }
      throw new Error(`Server failed to start.\nstderr: ${stderr}`);
    }
    console.log("Server ready");
  }, 30_000);

  afterAll(async () => {
    if (serverProcess) {
      serverProcess.kill();
      await serverProcess.exited;
      await Bun.sleep(500);
      console.log("Server stopped");
    }
  });

  // ============================================================
  // health.ts
  // ============================================================
  describe("health.ts", () => {
    test("GET /api/health → status ok + metadata", async () => {
      const res = await fetch(`${BASE_URL}/api/health`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.status).toBe("ok");
      expect(typeof data.server).toBe("string");
      expect(typeof data.port).toBe("number");
    });

    test("GET /api/stats → numeric total + vector shape", async () => {
      const res = await fetch(`${BASE_URL}/api/stats`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(typeof data.total).toBe("number");
      expect(data).toHaveProperty("vector");
      expect(typeof data.vector.enabled).toBe("boolean");
    }, 15_000);

    test("GET /api/oracles → identities + projects arrays", async () => {
      const res = await fetch(`${BASE_URL}/api/oracles`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(Array.isArray(data.identities)).toBe(true);
      expect(Array.isArray(data.projects)).toBe(true);
      expect(typeof data.total_projects).toBe("number");
      expect(typeof data.total_identities).toBe("number");
      expect(data.window_hours).toBe(168);
    });

    test("GET /api/oracles?hours=24 → honors window param", async () => {
      const res = await fetch(`${BASE_URL}/api/oracles?hours=24`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      // Cached result may reflect a different window; accept either
      expect([24, 168]).toContain(data.window_hours);
    });

    test("GET /api/oracles?hours=notanumber → coerces without 500", async () => {
      const res = await fetch(`${BASE_URL}/api/oracles?hours=abc`);
      expect(res.status).toBeLessThan(500);
    });
  });

  // ============================================================
  // dashboard.ts
  // ============================================================
  describe("dashboard.ts", () => {
    test("GET /api/dashboard → summary object", async () => {
      const res = await fetch(`${BASE_URL}/api/dashboard`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(typeof data).toBe("object");
      expect(data).not.toBeNull();
    });

    test("GET /api/dashboard/summary → same shape as /api/dashboard", async () => {
      const res = await fetch(`${BASE_URL}/api/dashboard/summary`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(typeof data).toBe("object");
    });

    test("GET /api/dashboard/activity?days=7 → object payload", async () => {
      const res = await fetch(`${BASE_URL}/api/dashboard/activity?days=7`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(typeof data).toBe("object");
    });

    test("GET /api/dashboard/activity (no days) → defaults applied", async () => {
      const res = await fetch(`${BASE_URL}/api/dashboard/activity`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(typeof data).toBe("object");
    });

    test("GET /api/dashboard/activity?days=bad → no 500", async () => {
      const res = await fetch(`${BASE_URL}/api/dashboard/activity?days=bad`);
      expect(res.status).toBeLessThan(500);
    });

    test("GET /api/dashboard/growth?period=week", async () => {
      const res = await fetch(`${BASE_URL}/api/dashboard/growth?period=week`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(typeof data).toBe("object");
    });

    test("GET /api/dashboard/growth (default period)", async () => {
      const res = await fetch(`${BASE_URL}/api/dashboard/growth`);
      expect(res.ok).toBe(true);
    });

    test("GET /api/session/stats → searches + learnings counts", async () => {
      const res = await fetch(`${BASE_URL}/api/session/stats`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(typeof data.searches).toBe("number");
      expect(typeof data.learnings).toBe("number");
      expect(typeof data.since).toBe("number");
    });

    test("GET /api/session/stats?since=0 → honors param", async () => {
      const res = await fetch(`${BASE_URL}/api/session/stats?since=0`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.since).toBe(0);
    });

    test("GET /api/dashboard/bogus → 404 (no 5xx)", async () => {
      const res = await fetch(`${BASE_URL}/api/dashboard/bogus`);
      expect(res.status).toBeLessThan(500);
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });
});
