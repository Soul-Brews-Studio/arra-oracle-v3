import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadUnifiedPlugins } from "../../src/plugins/unified-loader.ts";

const tmp = mkdtempSync(join(tmpdir(), "arra-unified-load-catch-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("loadUnifiedPlugins", () => {
  test("returns an empty runtime when discovery throws", async () => {
    const filePath = join(tmp, "not-a-dir");
    writeFileSync(filePath, "x");
    const warnings: string[] = [];
    const runtime = await loadUnifiedPlugins({ dirs: [filePath], warn: (msg) => warnings.push(msg) });
    expect(runtime.routes).toEqual([]);
    expect(warnings[0]).toContain("loader disabled");
  });
});
