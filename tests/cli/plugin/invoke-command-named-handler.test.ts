import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { invokePluginCommand } from "../../../cli/src/plugin/invoke.ts";
import { command, loaded, writeModule } from "./_fixtures.ts";

const tmp = mkdtempSync(join(tmpdir(), "arra-command-named-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("invokePluginCommand", () => {
  test("calls the named cliSubcommands handler", async () => {
    const entryPath = writeModule(join(tmp, "index.ts"), "export function run(ctx) { return { ok: true, output: ctx.args[0] }; }\n");
    const plugin = { ...loaded(), entryPath };
    const result = await invokePluginCommand(command(plugin, { handler: "run" }), { source: "cli", args: ["ok"] });
    expect(result).toEqual({ ok: true, output: "ok" });
  });
});
