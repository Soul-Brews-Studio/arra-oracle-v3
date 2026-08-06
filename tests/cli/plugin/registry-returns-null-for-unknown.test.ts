import { describe, expect, test } from "bun:test";
import { registerPlugins, resolveCommand } from "../../../cli/src/plugin/registry.ts";

describe("plugin registry", () => {
  test("returns null for unknown commands", () => {
    registerPlugins([]);
    expect(resolveCommand("missing")).toBeNull();
  });
});
