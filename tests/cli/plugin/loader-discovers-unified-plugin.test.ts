import { describe, expect, test } from "bun:test";
import { discoverPlugins } from "../../../cli/src/plugin/loader.ts";
import type { LoadedUnifiedPlugin } from "../../../src/plugins/unified-loader.ts";
import { manifest } from "./_fixtures.ts";

describe("discoverPlugins", () => {
  test("registers plugins returned by the unified loader", async () => {
    const unifiedPlugins: LoadedUnifiedPlugin[] = [{
      manifest: { ...manifest({ name: "unified" }), apiRoutes: [], mcpTools: [], proxy: [], menu: [], cliSubcommands: [] },
      dir: "/tmp/unified",
      entryPath: "/tmp/unified/index.ts",
    }];
    const result = await discoverPlugins({ unifiedPlugins, userPluginDir: "/tmp/missing-user", bundledPluginDir: "/tmp/missing-bundled" });
    expect(result.plugins.map((p) => p.manifest.name)).toEqual(["unified"]);
    expect(result.user).toBe(1);
  });
});
