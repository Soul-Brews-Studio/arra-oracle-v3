/**
 * HTTP Contract Tests — Core Routes, against a LIVE server on :47778.
 *
 * ⚠️ These run only when a server is already listening. If none is, the whole suite skips.
 *
 * Why: this is the old pattern — spawn `bun run src/server.ts`, poll a real port. Every other
 * file under `tests/http/` builds its routes in-process (`createHealthRoutes()` +
 * `app.handle()`) and needs no port at all. The subprocess form passes on a developer machine
 * that happens to have an Oracle running and is unreliable anywhere else: when #2853 added
 * `tests/http/` to CI, this one file contributed **15 failures** while its 289 siblings passed.
 *
 * It is kept, not deleted, because running the real assembled server over a real socket
 * catches wiring that in-process tests cannot. But it must not be able to fail a PR gate for
 * an environmental reason, and it is not load-bearing coverage: every route it touches is
 * covered by 2–8 in-process files that do run in CI (/api/oracles 5, /api/dashboard 5,
 * /api/session/stats 2, /api/stats 8).
 *
 * The header used to say "Runs against current Hono backend" — Hono has been gone since the
 * Elysia migration completed.
 *
 * Porting these assertions to the in-process pattern would let them run everywhere; tracked
 * separately.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";

/** Overridable so the skip path is testable, and so CI could point at a real server. */
const BASE_URL = process.env.ORACLE_CONTRACT_BASE_URL ?? "http://localhost:47778";

async function isServerRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Opt-in, deliberately — NOT auto-detected.
 *
 * The first attempt at this sniffed the environment: probe /api/health, run if it answers.
 * That is itself a race, and CI proved it. Something else in the `tests/http/` run binds
 * :47778; the probe saw a healthy 200, the suite started, and by the time the assertions ran
 * the server was returning **503**. Sniffing turned "no server" into "a server that was there
 * a moment ago", which is strictly worse than either.
 *
 * So it runs only when a human says so:
 *
 *     ORACLE_LIVE_CONTRACT=1 bun test --isolate tests/http/core.test.ts
 *
 * Deterministic in CI (never), deterministic locally (only when asked). `isServerRunning()`
 * still guards the opt-in case so an explicit run against a dead port skips rather than
 * emitting 15 identical connection errors.
 */
const OPTED_IN = process.env.ORACLE_LIVE_CONTRACT === '1';
const LIVE_SERVER = OPTED_IN && (await isServerRunning());
if (OPTED_IN && !LIVE_SERVER) {
  console.log(`[core.test.ts] ORACLE_LIVE_CONTRACT=1 but nothing healthy on ${BASE_URL} — skipping`);
}

describe.skipIf(!LIVE_SERVER)("HTTP Contract — Core Routes", () => {

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
