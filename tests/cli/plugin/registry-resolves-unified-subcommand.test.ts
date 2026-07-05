import { describe, expect, test } from "bun:test";
import { registerPlugins, resolveCommand } from "../../../cli/src/plugin/registry.ts";
import { loaded } from "./_fixtures.ts";

describe("plugin registry", () => {
  test("resolves unified cliSubcommands", () => {
    registerPlugins([loaded({ cliSubcommands: [{ command: "unified", help: "help", handler: "run" }] })]);
    const command = resolveCommand("UNIFIED");
    expect(command?.handler).toBe("run");
  });
});
