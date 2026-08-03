import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { invokePlugin } from "../invoke.ts";
import type { InvokeContext, LoadedPlugin } from "../types.ts";

// Handler that hangs forever — the ONLY way its invocation settles is the
// timeout, so the abort test is deterministic without racing a real delay.
const HANGING_HANDLER = "export default () => Promise.withResolvers().promise;";
// Handler gated on a test-controlled signal — the test resolves it and awaits
// the real completion, so the pass tests never wait on a wall-clock duration.
const GATED_HANDLER =
  'export default async () => { await globalThis.__ARRA_PROBE__; return { ok: true, output: "done" }; };';

// Named cast (rule: no inline cast in member access): a test-only global channel
// used to gate the probe handler, which lives in a separate imported file.
const probeGlobal = globalThis as typeof globalThis & { __ARRA_PROBE__?: Promise<void> };

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
afterEach(() => {
  delete probeGlobal.__ARRA_PROBE__;
});

function pluginWith(handlerSource: string, timeoutMs?: number): LoadedPlugin {
  const dir = mkdtempSync(join(tmpdir(), "arra-invoke-"));
  dirs.push(dir);
  const entryPath = join(dir, "index.ts");
  writeFileSync(entryPath, handlerSource);
  return {
    manifest: { name: "probe", version: "1.0.0", entry: "./index.ts", sdk: "^0.0.1", timeoutMs },
    dir,
    entryPath,
  };
}

const ctx: InvokeContext = { source: "cli", args: [] };

describe("invokePlugin per-plugin timeout", () => {
  // The arra-server plugin needs >5s for a cold HTTP start; the global default
  // cap is 5000ms. These prove manifest.timeoutMs is the effective cap, so the
  // server plugin's 20000ms lets a slow-but-healthy start finish instead of
  // being aborted at the 5s default.

  // Exception to no-real-timers: this exercises invokePlugin's OWN setTimeout
  // against the platform clock. The handler never settles, so only the 60ms
  // timeout can resolve the invocation — deterministic, no race, no tuned wait.
  test("handler is aborted at manifest.timeoutMs", async () => {
    const result = await invokePlugin(pluginWith(HANGING_HANDLER, 60), ctx);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("timed out after 60ms");
  });

  test("handler completing under a raised cap passes (manifest overrides the 5000ms default)", async () => {
    const gate = Promise.withResolvers<void>();
    probeGlobal.__ARRA_PROBE__ = gate.promise;
    const invocation = invokePlugin(pluginWith(GATED_HANDLER, 20000), ctx);
    gate.resolve(); // release the handler; we await its real completion
    const result = await invocation;
    expect(result.ok).toBe(true);
    expect(result.output).toBe("done");
  });

  test("a completed handler returns without waiting out the timeout window", async () => {
    // If the timer were awaited/leaked instead of cleared, this invocation
    // would hang for the full 20000ms and blow the test runner's own timeout.
    const gate = Promise.withResolvers<void>();
    probeGlobal.__ARRA_PROBE__ = gate.promise;
    const invocation = invokePlugin(pluginWith(GATED_HANDLER, 20000), ctx);
    gate.resolve();
    expect((await invocation).ok).toBe(true);
  });
});
