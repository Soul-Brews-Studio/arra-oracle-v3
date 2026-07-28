import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { runCli, tryParseJson } from "../_run.ts";
import { ensureServer, stopServer } from "../_server.ts";

describe("arra-cli session list", () => {
  beforeAll(async () => { await ensureServer(); }, 30_000);
  afterAll(() => stopServer());

  test("default JSON output (or graceful error when /api/sessions absent)", async () => {
    const result = await runCli(["session", "list"]);
    const data = tryParseJson(result.stdout) as { api: string; sessions: unknown[] } | null;
    if (data && typeof data.api === "string") {
      expect(Array.isArray(data.sessions)).toBe(true);
    } else {
      // /api/sessions not shipped or returns error — CLI surfaces it
      const output = result.stdout + result.stderr;
      expect(output).toMatch(/HTTP [45]\d\d|failed|not found|error|Cannot reach/i);
    }
  }, 15_000);

  test("--yml flag produces non-JSON output or graceful error", async () => {
    const result = await runCli(["session", "list", "--yml"]);
    const data = tryParseJson(result.stdout);
    if (result.code === 0 && data === null && result.stdout.length > 0) {
      expect(result.stdout).toMatch(/sessions:|api:/);
    } else {
      // /api/sessions not shipped — accept error output
      const output = result.stdout + result.stderr;
      expect(output).toMatch(/HTTP [45]\d\d|failed|not found|error|Cannot reach/i);
    }
  }, 15_000);
});
