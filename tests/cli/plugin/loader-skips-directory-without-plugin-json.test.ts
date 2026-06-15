import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { discoverPlugins } from "../../../cli/src/plugin/loader.ts";

const tmp = mkdtempSync(join(tmpdir(), "arra-loader-no-json-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("discoverPlugins", () => {
  test("skips plugin directories without plugin.json", async () => {
    mkdirSync(join(tmp, "user", "empty"), { recursive: true });
    const result = await discoverPlugins({ unifiedPlugins: [], userPluginDir: join(tmp, "user"), bundledPluginDir: join(tmp, "missing") });
    expect(result.plugins).toEqual([]);
  });
});
