import { describe, expect, test } from "bun:test";
import { listPlugins, registerPlugins } from "../../../cli/src/plugin/registry.ts";
import { loaded } from "./_fixtures.ts";

describe("plugin registry", () => {
  test("returns a copy of registered plugins", () => {
    registerPlugins([loaded({ name: "demo" })]);
    listPlugins().pop();
    expect(listPlugins()).toHaveLength(1);
  });
});
