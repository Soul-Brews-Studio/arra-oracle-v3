/**
 * HTTP API Integration Tests
 * Tests arra-oracle server endpoints (see const.ts for server name)
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
    } catch {
      // Server not ready yet
    }
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

describe("HTTP API Integration", () => {
  beforeAll(async () => {
    // Check if server already running
    if (await isServerRunning()) {
      console.log("Using existing server");
      return;
    }

    // Start server
    console.log("Starting server...");
    serverProcess = Bun.spawn(["bun", "run", "src/server.ts"], {
      cwd: import.meta.dir.replace("/src/integration", ""),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, ORACLE_CHROMA_TIMEOUT: "3000" },
    });

    const ready = await waitForServer();
    if (!ready) {
      // Capture server stderr for debugging
      let stderr = '';
      if (serverProcess.stderr) {
        const reader = serverProcess.stderr.getReader();
        try {
          const { value } = await reader.read();
          if (value) stderr = new TextDecoder().decode(value);
        } catch { /* ignore */ }
      }
      throw new Error(`Server failed to start within 15 seconds.\nServer stderr: ${stderr}`);
    }
    console.log("Server ready");
  }, 30_000);

  afterAll(() => {
    if (serverProcess) {
      serverProcess.kill();
      console.log("Server stopped");
    }
  });

  // ===================
  // Health & Stats
  // ===================
  describe("Health & Stats", () => {
    test("GET /api/health returns ok", async () => {
      const res = await fetch(`${BASE_URL}/api/health`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.status).toBe("ok");
    });

    test("GET /api/stats returns statistics", async () => {
      const res = await fetch(`${BASE_URL}/api/stats`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(typeof data.total).toBe("number");
    }, 15_000);

  });

  // ===================
  // Search
  // ===================
  describe("Search", () => {
    test("GET /api/search with query returns results", async () => {
      const res = await fetch(`${BASE_URL}/api/search?q=oracle`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(Array.isArray(data.results)).toBe(true);
    }, 30_000);

    test("GET /api/search with type filter", async () => {
      const res = await fetch(`${BASE_URL}/api/search?q=test&type=learning`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(Array.isArray(data.results)).toBe(true);
    }, 30_000);

    test("GET /api/search with limit and offset", async () => {
      const res = await fetch(`${BASE_URL}/api/search?q=test&limit=5&offset=0`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.results.length).toBeLessThanOrEqual(5);
    }, 30_000);

    test("GET /api/search handles empty query", async () => {
      const res = await fetch(`${BASE_URL}/api/search?q=`);
      // Should return empty or error gracefully
      expect(res.status).toBeLessThan(500);
    }, 30_000);
  });

  // ===================
  // List & Browse
  // ===================
  describe("List & Browse", () => {
    test("GET /api/list returns documents", async () => {
      const res = await fetch(`${BASE_URL}/api/list`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(Array.isArray(data.results)).toBe(true);
    });

    test("GET /api/list with type filter", async () => {
      const res = await fetch(`${BASE_URL}/api/list?type=principle`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(Array.isArray(data.results)).toBe(true);
    });

    test("GET /api/list with pagination", async () => {
      const res = await fetch(`${BASE_URL}/api/list?limit=10&offset=0`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.results.length).toBeLessThanOrEqual(10);
    });
  });

  // ===================
  // Reflect
  // ===================
  describe("Reflect", () => {
    test("GET /api/reflect returns response", async () => {
      const res = await fetch(`${BASE_URL}/api/reflect`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      // Empty DB returns { error: "No documents found" }, populated returns { content: ... }
      expect(data).toHaveProperty(data.content ? "content" : "error");
    });
  });

  // ===================
  // Dashboard
  // ===================
  describe("Dashboard", () => {
    test("GET /api/dashboard returns summary", async () => {
      const res = await fetch(`${BASE_URL}/api/dashboard`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(typeof data).toBe("object");
    });

    test("GET /api/dashboard/activity returns history", async () => {
      const res = await fetch(`${BASE_URL}/api/dashboard/activity?days=7`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(Array.isArray(data.activity) || typeof data === "object").toBe(true);
    });

    test("GET /api/session/stats returns usage", async () => {
      const res = await fetch(`${BASE_URL}/api/session/stats`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(typeof data).toBe("object");
    });
  });

  // ===================
  // Threads
  // ===================
  describe("Threads", () => {
    test("GET /api/threads returns thread list", async () => {
      const res = await fetch(`${BASE_URL}/api/threads`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(Array.isArray(data.threads)).toBe(true);
    });

    test("GET /api/threads with status filter", async () => {
      const res = await fetch(`${BASE_URL}/api/threads?status=active`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(Array.isArray(data.threads)).toBe(true);
    });
  });

  // ===================
  // Error Handling
  // ===================
  describe("Error Handling", () => {
    test("Invalid endpoint returns 404", async () => {
      const res = await fetch(`${BASE_URL}/api/nonexistent`);
      // Should be 404 or serve SPA
      expect(res.status).toBeLessThan(500);
    });

    test("GET /api/file without path returns error", async () => {
      const res = await fetch(`${BASE_URL}/api/file`);
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });
});
