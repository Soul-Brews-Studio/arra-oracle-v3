import { describe, expect, test } from "bun:test";
import { sortPluginsByDependencies } from "../../src/plugins/dependency-resolver.ts";
import type { LoadedUnifiedPlugin } from "../../src/plugins/unified-loader.ts";

function loaded(name: string, depends: string[] = []): LoadedUnifiedPlugin {
  return {
    dir: `/plugins/${name}`,
    entryPath: `/plugins/${name}/index.ts`,
    manifest: {
      name,
      version: "1.0.0",
      entry: "./index.ts",
      sdk: "^0.0.1",
      depends,
      apiRoutes: [],
      mcpTools: [],
      proxy: [],
      menu: [],
      cliSubcommands: [],
    },
  };
}

describe("sortPluginsByDependencies", () => {
  test("warns but keeps plugins with missing dependencies", () => {
    const warnings: string[] = [];
    const sorted = sortPluginsByDependencies([loaded("app", ["missing"])], {
      warn: (message) => warnings.push(message),
    });

    expect(sorted.map((plugin) => plugin.manifest.name)).toEqual(["app"]);
    expect(warnings).toEqual(['[unified-plugin] missing dependency "missing" for plugin "app"']);
  });
});
