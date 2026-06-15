import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { discoverPlugins } from "../../../cli/src/plugin/loader.ts";
import { writePlugin } from "./_fixtures.ts";

const tmp = mkdtempSync(join(tmpdir(), "arra-loader-user-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("discoverPlugins", () => {
  test("loads valid user plugin directories", async () => {
    writePlugin(join(tmp, "user", "demo"), { name: "demo" });
    const result = await discoverPlugins({ unifiedPlugins: [], userPluginDir: join(tmp, "user"), bundledPluginDir: join(tmp, "missing") });
    expect(result.plugins.map((p) => p.manifest.name)).toEqual(["demo"]);
    expect(result.user).toBe(1);
  });
});
