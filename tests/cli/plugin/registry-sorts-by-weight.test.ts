import { describe, expect, test } from "bun:test";
import { listPlugins, registerPlugins } from "../../../cli/src/plugin/registry.ts";
import { loaded } from "./_fixtures.ts";

describe("plugin registry", () => {
  test("sorts plugins by manifest weight", () => {
    registerPlugins([loaded({ name: "late", weight: 90 }), loaded({ name: "early", weight: 1 })]);
    expect(listPlugins().map((p) => p.manifest.name)).toEqual(["early", "late"]);
  });
});
