// HTTP contract tests for the remote MCP transport (src/http/mcp-route.ts):
// a real MCP SDK client round trip over Streamable HTTP, plus the bearer
// auth guard shared with /api/* (src/http/auth.ts).
// Isolated port + temp data dir so this doesn't collide with other
// tests/http/*.test.ts servers.
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import type { Subprocess } from "bun";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import fs from "fs";
import os from "os";
import path from "path";

const PORT = 47798;
const BASE_URL = `http://localhost:${PORT}`;
const MCP_URL = `${BASE_URL}/mcp`;
const TOKEN = "contract-test-mcp-bearer-token";

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

describe("HTTP contract: remote MCP (Streamable HTTP) transport", () => {
  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oracle-mcp-http-test-"));
    const cwd = import.meta.dir.replace(/\/tests\/http\/mcp$/, "");
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

  test("POST /mcp with no Authorization header returns 401", async () => {
    const res = await fetch(MCP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(res.status).toBe(401);
  });

  test("full round trip: initialize -> listTools -> callTool(oracle_stats)", async () => {
    const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
      requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    });
    const client = new Client({ name: "contract-test-client", version: "0.0.1" });

    await client.connect(transport);
    expect(transport.sessionId).toBeTruthy();

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("oracle_stats");
    expect(names).toContain("oracle_search");

    const result = await client.callTool({ name: "oracle_stats", arguments: {} });
    const content = result.content as Array<{ type: string; text?: string }>;
    expect(Array.isArray(content)).toBe(true);
    expect(content.length).toBeGreaterThan(0);
    const stats = JSON.parse(content[0]!.text!);
    expect(typeof stats.total).toBe("number");

    await client.close();
  }, 20_000);

  test("DELETE /mcp with unknown session id returns 400", async () => {
    const res = await fetch(MCP_URL, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${TOKEN}`, "mcp-session-id": "not-a-real-session" },
    });
    expect(res.status).toBe(400);
  });
});
