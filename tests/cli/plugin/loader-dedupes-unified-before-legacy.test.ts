import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { discoverPlugins } from "../../../cli/src/plugin/loader.ts";
import type { LoadedUnifiedPlugin } from "../../../src/plugins/unified-loader.ts";
import { manifest, writePlugin } from "./_fixtures.ts";

const tmp = mkdtempSync(join(tmpdir(), "arra-loader-dedupe-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("discoverPlugins", () => {
  test("keeps unified plugins before legacy duplicates", async () => {
    writePlugin(join(tmp, "user", "demo"), { name: "demo", description: "legacy" });
    const unifiedPlugins: LoadedUnifiedPlugin[] = [{
      manifest: { ...manifest({ name: "demo", description: "unified" }), apiRoutes: [], mcpTools: [], proxy: [], menu: [], cliSubcommands: [] },
      dir: "/tmp/unified-demo",
      entryPath: "/tmp/unified-demo/index.ts",
    }];
    const result = await discoverPlugins({ unifiedPlugins, userPluginDir: join(tmp, "user"), bundledPluginDir: join(tmp, "missing") });
    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0].manifest.description).toBe("unified");
  });
});
