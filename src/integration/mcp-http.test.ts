/**
 * MCP HTTP Transport Integration Tests
 *
 * Tests the /mcp Streamable HTTP endpoint:
 * - Bearer token auth (reject without/wrong token, accept valid)
 * - MCP protocol: initialize → tools/list → tools/call
 * - SSE stream response for GET
 * - DELETE (stateless no-op)
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import type { Subprocess } from "bun";

const BASE_URL = "http://localhost:47778";
const MCP_URL = `${BASE_URL}/mcp`;
const TEST_TOKEN = process.env.MCP_AUTH_TOKEN || "test-token";
let serverProcess: Subprocess | null = null;

async function waitForServer(maxAttempts = 30): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) return true;
    } catch {
      // Not ready yet
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

function mcpPost(body: object, token?: string): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
  };
  if (token !== undefined) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return fetch(MCP_URL, { method: "POST", headers, body: JSON.stringify(body) });
}

describe("MCP HTTP Transport (/mcp)", () => {
  beforeAll(async () => {
    if (await isServerRunning()) {
      console.log("Using existing server");
      return;
    }

    console.log("Starting server...");
    serverProcess = Bun.spawn(["bun", "run", "src/server.ts"], {
      cwd: import.meta.dir.replace("/src/integration", ""),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, MCP_AUTH_TOKEN: TEST_TOKEN, ORACLE_CHROMA_TIMEOUT: "3000" },
    });

    const ready = await waitForServer();
    if (!ready) {
      throw new Error("Server failed to start within 15 seconds");
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
  // Auth
  // ===================
  describe("Auth", () => {
    test("POST /mcp without Authorization header → 401", async () => {
      const res = await fetch(MCP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(401);
    });

    test("POST /mcp with wrong token → 401", async () => {
      const res = await mcpPost({}, "wrong-token");
      expect(res.status).toBe(401);
    });

    test("POST /mcp with empty Bearer → 401", async () => {
      const res = await fetch(MCP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(401);
    });
  });

  // ===================
  // MCP Protocol
  // ===================
  describe("MCP Protocol", () => {
    const initRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0" },
      },
    };

    test("POST /mcp initialize with valid token → 200", async () => {
      const res = await mcpPost(initRequest, TEST_TOKEN);
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.jsonrpc).toBe("2.0");
      expect(body.id).toBe(1);
      expect(body.result).toBeDefined();
      expect(body.result.serverInfo).toBeDefined();
    }, 15_000);

    test("POST /mcp tools/list returns arra_* tools", async () => {
      // Stateless: must re-initialize each request sequence
      await mcpPost(initRequest, TEST_TOKEN);

      const res = await mcpPost(
        { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
        TEST_TOKEN
      );
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.result).toBeDefined();
      expect(Array.isArray(body.result.tools)).toBe(true);
      expect(body.result.tools.length).toBeGreaterThan(5);

      const toolNames = body.result.tools.map((t: any) => t.name);
      expect(toolNames).toContain("arra_search");
      expect(toolNames).toContain("arra_learn");
      expect(toolNames).toContain("arra_stats");
    }, 15_000);

    test("POST /mcp tools/call arra_stats → returns stats", async () => {
      const res = await mcpPost(
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "arra_stats", arguments: {} },
        },
        TEST_TOKEN
      );
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.result).toBeDefined();
      expect(Array.isArray(body.result.content)).toBe(true);
      expect(body.result.content[0].type).toBe("text");
    }, 15_000);

    test("POST /mcp with malformed JSON-RPC → error response (not crash)", async () => {
      const res = await mcpPost({ jsonrpc: "2.0", id: 99 }, TEST_TOKEN);
      // Transport returns 400 for malformed JSON-RPC (missing method), MCP protocol errors are 200
      expect([200, 400]).toContain(res.status);
      expect(res.status).toBeLessThan(500);
    }, 15_000);

    test("POST /mcp unknown tool → error in response", async () => {
      const res = await mcpPost(
        {
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: { name: "nonexistent_tool", arguments: {} },
        },
        TEST_TOKEN
      );
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      // Should have error in result or result.isError
      const hasError = body.error || body.result?.isError;
      expect(hasError).toBeTruthy();
    }, 15_000);
  });

  // ===================
  // SSE GET endpoint
  // ===================
  describe("SSE GET", () => {
    test("GET /mcp with valid token → 200 or SSE stream", async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      try {
        const res = await fetch(MCP_URL, {
          method: "GET",
          headers: { "Authorization": `Bearer ${TEST_TOKEN}`, "Accept": "text/event-stream" },
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        expect(res.status).toBeLessThan(500);
      } catch (e: any) {
        clearTimeout(timeoutId);
        // Abort is expected — SSE streams stay open
        if (e.name !== "AbortError") throw e;
      }
    }, 10_000);
  });

  // ===================
  // DELETE (stateless no-op)
  // ===================
  describe("DELETE", () => {
    test("DELETE /mcp with valid token → not 500", async () => {
      const res = await fetch(MCP_URL, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${TEST_TOKEN}` },
      });
      expect(res.status).toBeLessThan(500);
    }, 10_000);
  });

  // ===================
  // Regression: existing REST API unaffected
  // ===================
  describe("REST API regression", () => {
    test("GET /api/health still works", async () => {
      const res = await fetch(`${BASE_URL}/api/health`);
      expect(res.ok).toBe(true);
    });

    test("GET /api/stats still works", async () => {
      const res = await fetch(`${BASE_URL}/api/stats`);
      expect(res.ok).toBe(true);
    });
  });
});
