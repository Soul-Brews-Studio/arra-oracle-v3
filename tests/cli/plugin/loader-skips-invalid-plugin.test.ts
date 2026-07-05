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

  test("skips plugin entries that escape plugin directory", async () => {
    const userDir = join(tmp, "escape-user");
    const dir = join(userDir, "bad-entry");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(userDir, "outside.ts"), "export default () => ({ ok: true });\n");
    writeFileSync(join(dir, "plugin.json"), JSON.stringify({
      name: "bad-entry",
      version: "1.0.0",
      entry: "../outside.ts",
      sdk: "^0.0.1",
    }));

    const result = await discoverPlugins({
      unifiedPlugins: [],
      userPluginDir: userDir,
      bundledPluginDir: join(tmp, "missing-escape"),
    });
    expect(result.plugins).toEqual([]);
  });
});
