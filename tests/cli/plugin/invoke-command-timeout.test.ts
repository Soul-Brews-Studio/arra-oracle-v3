import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { invokePluginCommand } from "../../../cli/src/plugin/invoke.ts";
import { command, loaded, writeModule } from "./_fixtures.ts";

const tmp = mkdtempSync(join(tmpdir(), "arra-command-timeout-"));
const previousTimeout = process.env.ARRA_PLUGIN_TIMEOUT_MS;
afterAll(() => {
  if (previousTimeout === undefined) delete process.env.ARRA_PLUGIN_TIMEOUT_MS;
  else process.env.ARRA_PLUGIN_TIMEOUT_MS = previousTimeout;
  rmSync(tmp, { recursive: true, force: true });
});

describe("invokePluginCommand", () => {
  test("times out slow handlers", async () => {
    process.env.ARRA_PLUGIN_TIMEOUT_MS = "5";
    const entryPath = writeModule(join(tmp, "index.ts"), "export default () => new Promise(() => {});\n");
    const plugin = { ...loaded(), entryPath };
    const result = await invokePluginCommand(command(plugin), { source: "cli", args: [] });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("timed out after 5ms");
  });
});
