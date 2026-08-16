/**
 * `scripts/mcp-bridge.cjs` goes away when the client does.
 *
 * A stdio MCP server is shut down by closing its stdin. With a bridge in the
 * middle there are two processes to shut down, and two ways to get it wrong:
 * the child keeps running (an orphaned Bun holding the vector store open, which
 * on Windows means a lock nobody can find), or the bridge itself never exits
 * because the stdin read handle keeps its event loop alive. Both look like
 * "the MCP server won't restart" to whoever hits them.
 *
 * The bridge deliberately does not call `process.exit()` — it sets exitCode and
 * releases stdin so buffered stdout still drains — so "it exits at all" is a
 * real claim about that code, not a triviality.
 */
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../..");
const bridge = join(repoRoot, "scripts/mcp-bridge.cjs");
const tempDirs: string[] = [];
const childProcesses: Array<{ kill: () => void }> = [];

afterEach(async () => {
  for (const proc of childProcesses.splice(0)) proc.kill();
  for (const dir of tempDirs.splice(0)) {
    if (existsSync(dir)) rmSync(dir, { recursive: true });
  }
});

test("closing the bridge's stdin shuts down bun and then the bridge", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "arra-oracle-mcp-bridge-exit-"));
  tempDirs.push(dataDir);

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
  // Drain both streams: an unread pipe fills and would stall the shutdown this
  // test is timing, turning a real hang and a full buffer into the same red.
  const drained = Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  proc.stdin.end();

  const exited = await Promise.race([
    proc.exited,
    Bun.sleep(20_000).then(() => "timeout" as const),
  ]);
  expect(exited).not.toBe("timeout");
  // Not `toBe(0)`: what matters is that EOF is an ordinary shutdown and not
  // reported to the client as a crash. 143 (SIGTERM) would mean something had
  // to kill it.
  expect(exited).toBe(0);

  await drained;
}, 30_000);
