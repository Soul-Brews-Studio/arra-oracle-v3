import { describe, expect, test } from "bun:test";
import { invokePluginCommand } from "../../../cli/src/plugin/invoke.ts";
import { command, loaded } from "./_fixtures.ts";

describe("invokePluginCommand", () => {
  test("returns import errors as InvokeResult failures", async () => {
    const plugin = { ...loaded(), entryPath: "/tmp/no-such-command-entry.ts" };
    const result = await invokePluginCommand(command(plugin), { source: "cli", args: [] });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Cannot find module");
  });
});
