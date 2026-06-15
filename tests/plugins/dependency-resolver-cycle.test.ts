import { describe, expect, test } from "bun:test";
import { sortPluginsByDependencies } from "../../src/plugins/dependency-resolver.ts";
import type { LoadedUnifiedPlugin } from "../../src/plugins/unified-loader.ts";

function loaded(name: string, depends: string[]): LoadedUnifiedPlugin {
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
  test("warns and keeps cyclic plugins loadable", () => {
    const warnings: string[] = [];
    const sorted = sortPluginsByDependencies([loaded("a", ["b"]), loaded("b", ["a"])], {
      warn: (message) => warnings.push(message),
    });

    expect(sorted.map((plugin) => plugin.manifest.name)).toEqual(["b", "a"]);
    expect(warnings).toEqual(["[unified-plugin] dependency cycle ignored: a -> b -> a"]);
  });
});
