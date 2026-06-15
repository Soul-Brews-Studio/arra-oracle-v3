import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { discoverPlugins } from "../../../cli/src/plugin/loader.ts";
import { writePlugin } from "./_fixtures.ts";

const tmp = mkdtempSync(join(tmpdir(), "arra-loader-bundled-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("discoverPlugins", () => {
  test("counts valid bundled plugin directories", async () => {
    writePlugin(join(tmp, "bundled", "demo"), { name: "demo" });
    const result = await discoverPlugins({ unifiedPlugins: [], userPluginDir: join(tmp, "missing"), bundledPluginDir: join(tmp, "bundled") });
    expect(result.plugins.map((p) => p.manifest.name)).toEqual(["demo"]);
    expect(result.bundled).toBe(1);
  });
});
