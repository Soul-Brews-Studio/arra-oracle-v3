import { afterEach, expect, test } from "bun:test";
import type { ReadableStream } from "node:stream/web";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../..");
const binEntry = join(repoRoot, "bin/arra.ts");
const tempDirs: string[] = [];
const childProcesses: Array<{ kill: () => void }> = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function nextPort(): number {
  return 49152 + Math.floor(Math.random() * 1000);
}

async function waitForHealth(baseUrl: string): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
    } catch { /* still booting */ }
    await Bun.sleep(250);
  }
  throw new Error(`server did not become healthy: ${baseUrl}`);
}

async function readStdoutLine(
  stdout: ReadableStream<Uint8Array>,
  timeoutMs: number,
): Promise<string> {
  const reader = stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let timer: Timer | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timed out waiting for stdout JSON-RPC")), timeoutMs);
  });

  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), timeout]);
      if (done) throw new Error("stdout closed before JSON-RPC response");
      buffer += decoder.decode(value);
      const newline = buffer.indexOf("\n");
      if (newline !== -1) return buffer.slice(0, newline);
    }
  } finally {
    if (timer) clearTimeout(timer);
    reader.releaseLock();
  }
}

afterEach(async () => {
  for (const proc of childProcesses.splice(0)) proc.kill();
  for (const dir of tempDirs.splice(0)) {
    if (existsSync(dir)) rmSync(dir, { recursive: true });
  }
});

test("arra-oracle mcp emits JSON-RPC on stdout and logs on stderr", async () => {
  const port = nextPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const dataDir = tempDir("arra-oracle-mcp-dispatch-");
  const proc = Bun.spawn(["bun", binEntry, "mcp", "--read-only"], {
    cwd: repoRoot,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      ORACLE_API: baseUrl,
      ORACLE_PORT: String(port),
      ORACLE_DATA_DIR: dataDir,
      ORACLE_DB_PATH: join(dataDir, "oracle.db"),
      ORACLE_INDEXER_ENQUEUE: "0",
    },
  });
  childProcesses.push(proc);
  const stderrText = new Response(proc.stderr).text();

  proc.stdin.write(JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "arra-oracle-dispatch-test", version: "0.0.0" },
    },
  }) + "\n");

  const line = await readStdoutLine(proc.stdout, 10_000);
  const response = JSON.parse(line) as { id?: number; result?: unknown };
  expect(response.id).toBe(1);
  expect(response.result).toBeDefined();
  expect(line).not.toContain("Arra Oracle MCP Server running");

  await expect(fetch(`${baseUrl}/api/health`)).rejects.toThrow();
  proc.kill();
  await proc.exited;

  const stderr = await stderrText;
  expect(stderr).toContain("Arra Oracle MCP Server running on stdio");
  expect(stderr).not.toContain("Arra Oracle HTTP server");
});

test("arra-oracle without a subcommand defaults to HTTP serve", async () => {
  const port = nextPort();
  const dataDir = tempDir("arra-oracle-serve-dispatch-");
  const repoDir = tempDir("arra-oracle-serve-repo-");
  const proc = Bun.spawn(["bun", binEntry, "--port", String(port)], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      ORACLE_DATA_DIR: dataDir,
      ORACLE_DB_PATH: join(dataDir, "oracle.db"),
      ORACLE_REPO_ROOT: repoDir,
      ORACLE_INDEXER_ENQUEUE: "0",
    },
  });
  childProcesses.push(proc);
  const stdoutText = new Response(proc.stdout).text();
  const stderrText = new Response(proc.stderr).text();

  await waitForHealth(`http://127.0.0.1:${port}`);
  proc.kill();
  await proc.exited;

  expect(await stdoutText).toContain(`Arra Oracle HTTP server → http://localhost:${port}`);
  expect(await stderrText).not.toContain("Arra Oracle MCP Server running");
});
