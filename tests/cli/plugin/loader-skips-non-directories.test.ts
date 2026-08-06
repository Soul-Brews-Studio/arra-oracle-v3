import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { discoverPlugins } from "../../../cli/src/plugin/loader.ts";

const tmp = mkdtempSync(join(tmpdir(), "arra-loader-files-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("discoverPlugins", () => {
  test("skips non-directory entries", async () => {
    mkdirSync(join(tmp, "user"), { recursive: true });
    writeFileSync(join(tmp, "user", "not-a-dir"), "x");
    const result = await discoverPlugins({ unifiedPlugins: [], userPluginDir: join(tmp, "user"), bundledPluginDir: join(tmp, "missing") });
    expect(result.plugins).toEqual([]);
  });
});
