import { describe, expect, test } from "bun:test";
import { registerPlugins, resolveCommand } from "../../../cli/src/plugin/registry.ts";
import { loaded } from "./_fixtures.ts";

describe("plugin registry", () => {
  test("continues past non-matching aliases", () => {
    registerPlugins([loaded({ cli: { command: "demo", aliases: ["nope"], help: "help" } })]);
    expect(resolveCommand("missing")).toBeNull();
  });
});
