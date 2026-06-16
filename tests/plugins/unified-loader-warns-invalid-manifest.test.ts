import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverUnifiedPluginManifests } from "../../src/plugins/unified-loader.ts";

const tmp = mkdtempSync(join(tmpdir(), "arra-unified-invalid-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("discoverUnifiedPluginManifests", () => {
  test("warns and skips invalid plugin manifests", async () => {
    const dir = join(tmp, "bad");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "plugin.json"), "{ nope");
    const warnings: string[] = [];
    const found = await discoverUnifiedPluginManifests({ dirs: [tmp], warn: (msg) => warnings.push(msg) });
    expect(found).toEqual([]);
    expect(warnings[0]).toContain("[unified-plugin] skipped");
  });
});
