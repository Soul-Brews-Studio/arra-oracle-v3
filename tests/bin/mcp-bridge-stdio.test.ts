/**
 * `scripts/mcp-bridge.cjs` really does carry JSON-RPC in both directions.
 *
 * The bridge exists for Windows hosts, and nothing in CI runs Windows — so the
 * failure mode it guards against is that the shim quietly rots (entrypoint
 * moves, flag changes, a stray `console.log` lands in the stdout stream the
 * protocol owns) and nobody finds out until a Windows user reports the server
 * as dead. The copying itself is platform-independent, so it can be proven
 * here: spawn the bridge with node, hand it an `initialize`, read the response.
 *
 * Sibling of `arra-oracle-dispatch.test.ts`, which asserts the same handshake
 * against the launcher the bridge wraps.
 */
import { afterEach, expect, test } from "bun:test";
import type { ReadableStream } from "node:stream/web";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../..");
const bridge = join(repoRoot, "scripts/mcp-bridge.cjs");
const tempDirs: string[] = [];
const childProcesses: Array<{ kill: () => void }> = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/**
 * The first line the bridge emits is not necessarily the response: the server
 * itself writes `[sqlite-vec] Connected` to stdout from
 * `src/vector/adapters/sqlite-vec.ts:67`, a `console.log` in a process whose
 * stdout is the protocol stream. That happens identically when the launcher is
 * spawned directly, so it is not the bridge's doing and not this test's to
 * assert on — collect lines until one parses as the reply we asked for.
 */
async function readJsonRpcLine(
  stdout: ReadableStream<Uint8Array>,
  id: number,
  timeoutMs: number,
): Promise<{ line: string; seen: string[] }> {
  const reader = stdout.getReader();
  const decoder = new TextDecoder();
  const seen: string[] = [];
  let buffer = "";
  let timer: Timer | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timed out waiting for stdout JSON-RPC")), timeoutMs);
  });

  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), timeout]);
      if (done) throw new Error(`stdout closed before JSON-RPC response; saw ${seen.join(" | ")}`);
      buffer += decoder.decode(value);
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        seen.push(line);
        try {
          const parsed = JSON.parse(line) as { id?: number };
          if (parsed.id === id) return { line, seen };
        } catch { /* not a JSON-RPC frame — keep reading */ }
        newline = buffer.indexOf("\n");
      }
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

test("mcp-bridge.cjs forwards initialize to bun and the reply back on stdout", async () => {
  const dataDir = tempDir("arra-oracle-mcp-bridge-");
  const proc = Bun.spawn(["node", bridge], {
    cwd: repoRoot,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
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
      clientInfo: { name: "arra-oracle-mcp-bridge-test", version: "0.0.0" },
    },
  }) + "\n");

  const { line, seen } = await readJsonRpcLine(proc.stdout, 1, 30_000);
  const response = JSON.parse(line) as { id?: number; result?: unknown };
  expect(response.id).toBe(1);
  expect(response.result).toBeDefined();

  // The bridge must be invisible on stdout: its own diagnostics, and the
  // server's banner, belong on the inherited stderr. One stray line from the
  // shim and every client parses a protocol error instead of a response.
  expect(seen.join("\n")).not.toContain("[mcp-bridge]");
  expect(seen.join("\n")).not.toContain("Arra Oracle MCP Server running");

  proc.kill();
  await proc.exited;

  const stderr = await stderrText;
  expect(stderr).toContain("Arra Oracle MCP Server running on stdio");
}, 40_000);
