import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverUnifiedPluginManifests } from "../../src/plugins/unified-loader.ts";
import { pluginDir } from "./_fixtures.ts";

const tmp = mkdtempSync(join(tmpdir(), "arra-unified-discover-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("discoverUnifiedPluginManifests", () => {
  test("discovers valid unique plugin directories only", async () => {
    pluginDir(tmp, "demo", {});
    pluginDir(tmp, "duplicate-dir", { name: "demo" });
    pluginDir(tmp, "disabled", { enabled: false });
    mkdirSync(join(tmp, "empty-dir"));
    writeFileSync(join(tmp, "plain-file"), "not a plugin");
    const found = await discoverUnifiedPluginManifests({ dirs: [tmp, "", tmp, join(tmp, "missing")] });
    expect(found.map((p) => p.manifest.name)).toEqual(["demo"]);
  });
});
