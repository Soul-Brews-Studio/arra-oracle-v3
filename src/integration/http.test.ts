/**
 * HTTP API Integration Tests
 * Tests arra-oracle server endpoints (see const.ts for server name)
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import type { Subprocess } from "bun";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

let serverProcess: Subprocess | null = null;
let tmpRoot = "";
let baseUrl = "";

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(maxAttempts = 30): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return true;
    } catch {
      // Server not ready yet
    }
    await Bun.sleep(500);
  }
  return false;
}


describe("HTTP API Integration", () => {
  beforeAll(async () => {
    const repoRoot = path.resolve(import.meta.dir, "../..");
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "arra-http-integration-"));
    const dataDir = path.join(tmpRoot, "data");
    const repoDataRoot = path.join(tmpRoot, "repo");
    fs.mkdirSync(repoDataRoot, { recursive: true });

    const port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;

    console.log("Starting server...");
    serverProcess = Bun.spawn(["bun", "run", "src/server.ts"], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        ORACLE_PORT: String(port),
        ORACLE_DATA_DIR: dataDir,
        ORACLE_DB_PATH: path.join(dataDir, "oracle.db"),
        ORACLE_REPO_ROOT: repoDataRoot,
        ORACLE_CHROMA_TIMEOUT: "3000",
        VECTOR_URL: "",
        MAW_JS_URL: "http://127.0.0.1:1",
      },
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

  afterAll(async () => {
    if (serverProcess) {
      serverProcess.kill();
      await serverProcess.exited.catch(() => undefined);
      console.log("Server stopped");
    }
    serverProcess = null;
    if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  // ===================
  // Health & Stats
  // ===================
  describe("Health & Stats", () => {
    test("GET /api/health returns ok", async () => {
      const res = await fetch(`${baseUrl}/api/health`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.status).toBe("ok");
    });

    test("GET /api/stats returns statistics", async () => {
      const res = await fetch(`${baseUrl}/api/stats`);
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
      const res = await fetch(`${baseUrl}/api/search?q=oracle`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(Array.isArray(data.results)).toBe(true);
    }, 30_000);

    test("GET /api/search with type filter", async () => {
      const res = await fetch(`${baseUrl}/api/search?q=test&type=learning`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(Array.isArray(data.results)).toBe(true);
    }, 30_000);

    test("GET /api/search with limit and offset", async () => {
      const res = await fetch(`${baseUrl}/api/search?q=test&limit=5&offset=0`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.results.length).toBeLessThanOrEqual(5);
    }, 30_000);

    test("GET /api/search handles empty query", async () => {
      const res = await fetch(`${baseUrl}/api/search?q=`);
      // Should return empty or error gracefully
      expect(res.status).toBeLessThan(500);
    }, 30_000);
  });

  // ===================
  // List & Browse
  // ===================
  describe("List & Browse", () => {
    test("GET /api/list returns documents", async () => {
      const res = await fetch(`${baseUrl}/api/list`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(Array.isArray(data.results)).toBe(true);
    });

    test("GET /api/list with type filter", async () => {
      const res = await fetch(`${baseUrl}/api/list?type=principle`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(Array.isArray(data.results)).toBe(true);
    });

    test("GET /api/list with pagination", async () => {
      const res = await fetch(`${baseUrl}/api/list?limit=10&offset=0`);
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
      const res = await fetch(`${baseUrl}/api/reflect`);
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
      const res = await fetch(`${baseUrl}/api/dashboard`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(typeof data).toBe("object");
    });

    test("GET /api/dashboard/activity returns history", async () => {
      const res = await fetch(`${baseUrl}/api/dashboard/activity?days=7`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(Array.isArray(data.activity) || typeof data === "object").toBe(true);
    });

    test("GET /api/session/stats returns usage", async () => {
      const res = await fetch(`${baseUrl}/api/session/stats`);
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
      const res = await fetch(`${baseUrl}/api/threads`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(Array.isArray(data.threads)).toBe(true);
    });

    test("GET /api/threads with status filter", async () => {
      const res = await fetch(`${baseUrl}/api/threads?status=active`);
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
      const res = await fetch(`${baseUrl}/api/nonexistent`);
      // Should be 404 or serve SPA
      expect(res.status).toBeLessThan(500);
    });

    test("GET /api/file without path returns error", async () => {
      const res = await fetch(`${baseUrl}/api/file`);
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });
});
