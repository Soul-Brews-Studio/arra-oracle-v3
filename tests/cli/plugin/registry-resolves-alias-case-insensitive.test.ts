import { describe, expect, test } from "bun:test";
import { registerPlugins, resolveCommand } from "../../../cli/src/plugin/registry.ts";
import { loaded } from "./_fixtures.ts";

describe("plugin registry", () => {
  test("resolves legacy aliases case-insensitively", () => {
    registerPlugins([loaded({ cli: { command: "demo", aliases: ["Hi"], help: "help" } })]);
    expect(resolveCommand("hi")?.command).toBe("demo");
  });
});
