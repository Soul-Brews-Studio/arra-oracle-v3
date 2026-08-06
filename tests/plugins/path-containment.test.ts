import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  discoverUnifiedPluginManifests,
} from "../../src/plugins/unified-loader.ts";
import { resolveContainedPluginEntry } from "../../src/plugins/path-containment.ts";
import { pluginDir } from "./_fixtures.ts";

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "arra-plugin-path-"));
  temps.push(dir);
  return dir;
}

describe("plugin entry path containment", () => {
  test("allows normal entry paths", async () => {
    const tmp = tempRoot();
    const dir = pluginDir(tmp, "normal", {});
    const found = await discoverUnifiedPluginManifests({ dirs: [tmp] });

    expect(found).toHaveLength(1);
    expect(found[0]?.entryPath).toBe(realpathSync(join(dir, "index.ts")));
  });

  test("rejects traversal entry paths", async () => {
    const tmp = tempRoot();
    const dir = pluginDir(tmp, "escape", { entry: "../../../etc/passwd" });
    const warnings: string[] = [];

    expect(() => resolveContainedPluginEntry(dir, "../../../etc/passwd"))
      .toThrow("plugin entry escapes plugin directory");
    expect(await discoverUnifiedPluginManifests({ dirs: [tmp], warn: (msg) => warnings.push(msg) }))
      .toEqual([]);
    expect(warnings[0]).toContain("plugin entry escapes plugin directory");
  });

  test("rejects symlinked plugin directories that point outside the plugin root", async () => {
    const root = tempRoot();
    const externalRoot = tempRoot();
    const externalPlugin = pluginDir(externalRoot, "external", {});
    symlinkSync(externalPlugin, join(root, "linked-plugin"), "dir");
    const warnings: string[] = [];

    expect(await discoverUnifiedPluginManifests({ dirs: [root], warn: (msg) => warnings.push(msg) }))
      .toEqual([]);
    expect(warnings[0]).toContain("plugin directory symlink escapes plugin root");
  });

  test("rejects entry symlinks that point outside the plugin directory", () => {
    const tmp = tempRoot();
    const externalDir = join(tmp, "external");
    mkdirSync(externalDir);
    const externalEntry = join(externalDir, "index.ts");
    writeFileSync(externalEntry, "export default () => ({ ok: false });\n");

    const dir = pluginDir(tmp, "symlinked", { entry: "./linked.ts" });
    symlinkSync(externalEntry, join(dir, "linked.ts"));

    expect(() => resolveContainedPluginEntry(dir, "./linked.ts"))
      .toThrow("plugin entry escapes plugin directory");
  });
});
