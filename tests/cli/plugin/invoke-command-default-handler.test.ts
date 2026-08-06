import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { invokePluginCommand } from "../../../cli/src/plugin/invoke.ts";
import { command, loaded, writeModule } from "./_fixtures.ts";

const tmp = mkdtempSync(join(tmpdir(), "arra-command-default-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("invokePluginCommand", () => {
  test("uses default handler when no command handler is named", async () => {
    const entryPath = writeModule(join(tmp, "index.ts"), "export default () => ({ ok: true, output: 'default' });\n");
    const plugin = { ...loaded(), entryPath };
    const result = await invokePluginCommand(command(plugin), { source: "cli", args: [] });
    expect(result).toEqual({ ok: true, output: "default" });
  });
});
