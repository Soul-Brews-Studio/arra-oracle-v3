import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { invokePluginCommand } from "../../../cli/src/plugin/invoke.ts";
import { command, loaded, writeModule } from "./_fixtures.ts";

const tmp = mkdtempSync(join(tmpdir(), "arra-command-missing-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("invokePluginCommand", () => {
  test("reports a missing named handler", async () => {
    const entryPath = writeModule(join(tmp, "index.ts"), "export default () => ({ ok: true });\n");
    const plugin = { ...loaded(), entryPath };
    const result = await invokePluginCommand(command(plugin, { handler: "missing" }), { source: "cli", args: [] });
    expect(result).toEqual({ ok: false, error: "plugin demo command demo: handler must be a function" });
  });
});
