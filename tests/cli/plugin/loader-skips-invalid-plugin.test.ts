import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { discoverPlugins } from "../../../cli/src/plugin/loader.ts";

const tmp = mkdtempSync(join(tmpdir(), "arra-loader-invalid-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("discoverPlugins", () => {
  test("skips invalid plugin manifests", async () => {
    const dir = join(tmp, "user", "bad");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "plugin.json"), "{ bad json");
    const result = await discoverPlugins({ unifiedPlugins: [], userPluginDir: join(tmp, "user"), bundledPluginDir: join(tmp, "missing") });
    expect(result.plugins).toEqual([]);
  });
});
