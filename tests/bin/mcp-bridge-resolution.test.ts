/**
 * `scripts/mcp-bridge.cjs` resolves what it claims to resolve.
 *
 * The bridge is only ever executed on Windows, so every one of its assumptions
 * is unverified by the rest of the suite: it hardcodes a path to `bin/mcp.ts`
 * that nothing else on this platform reads, and if that entrypoint is renamed
 * the shim keeps type-checking, keeps linting, and starts failing for the one
 * group of users who cannot be reached by CI. These are the cheap assertions
 * that make the rename go red here instead of there.
 *
 * The module is required rather than spawned — it only calls `bridge()` under
 * `require.main === module`, so importing it starts nothing.
 */
import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../..");
const require_ = createRequire(import.meta.url);
const shim = require_(join(repoRoot, "scripts/mcp-bridge.cjs")) as {
  exitCodeFor: (code: number | null, signal: string | null) => number;
  resolveBun: () => string;
  resolveEntry: (root?: string) => string;
  resolveRoot: () => string;
};

test("the entrypoint the bridge spawns is a file that exists in this repo", () => {
  const entry = shim.resolveEntry();
  // Existence first, deliberately: if the launcher is renamed and resolveEntry
  // is updated to match, this stays green and only the line below needs
  // touching. If the launcher is renamed and the shim is NOT updated, this is
  // the assertion that fires, with the dead path in the message. Do not delete
  // it — nothing else on this platform reads that path.
  expect(existsSync(entry), `${entry} does not exist`).toBe(true);
  expect(entry).toBe(join(repoRoot, "bin", "mcp.ts"));
});

test("the bridge roots itself at the repo, not at the caller's cwd", () => {
  // An MCP client spawns the bridge from whatever directory it happens to be
  // in. Resolving from __dirname is what makes that irrelevant.
  expect(shim.resolveRoot()).toBe(repoRoot);
});

test("ORACLE_BUN_BIN overrides the bun on PATH", () => {
  const original = process.env.ORACLE_BUN_BIN;
  try {
    delete process.env.ORACLE_BUN_BIN;
    expect(shim.resolveBun()).toBe("bun");
    // The knob exists because a Windows MCP client spawns with the PATH it
    // inherited at login, which frequently has no bun in it.
    process.env.ORACLE_BUN_BIN = "C:\\bun\\bun.exe";
    expect(shim.resolveBun()).toBe("C:\\bun\\bun.exe");
  } finally {
    if (original === undefined) delete process.env.ORACLE_BUN_BIN;
    else process.env.ORACLE_BUN_BIN = original;
  }
});

test("a child killed by a signal is not reported to the client as success", () => {
  // The salvaged original did `process.exit(code || 0)`, and a child that dies
  // by signal reports code === null — so a Bun crash, the exact thing this shim
  // exists to work around, was handed to the MCP client as a clean exit.
  expect(shim.exitCodeFor(null, "SIGSEGV")).toBeGreaterThan(128);
  expect(shim.exitCodeFor(null, "SIGTERM")).toBeGreaterThan(128);
  expect(shim.exitCodeFor(0, null)).toBe(0);
  expect(shim.exitCodeFor(3, null)).toBe(3);
});
