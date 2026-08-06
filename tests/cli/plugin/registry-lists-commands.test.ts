import { describe, expect, test } from "bun:test";
import { listCommands, registerPlugins } from "../../../cli/src/plugin/registry.ts";
import { loaded } from "./_fixtures.ts";

describe("plugin registry", () => {
  test("lists legacy and unified commands from one plugin", () => {
    registerPlugins([loaded({
      cli: { command: "legacy", help: "legacy help" },
      cliSubcommands: [{ command: "unified", help: "unified help" }],
    })]);
    expect(listCommands().map((c) => c.command)).toEqual(["legacy", "unified"]);
  });
});
