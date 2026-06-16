import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadUnifiedPlugins } from "../../src/plugins/unified-loader.ts";
import { pluginDir } from "./_fixtures.ts";

const tmp = mkdtempSync(join(tmpdir(), "arra-unified-lifecycle-fail-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("UnifiedRuntime plugin lifecycle hook failures", () => {
  test("warns instead of failing startup", async () => {
    pluginDir(tmp, "lifecycle-fail", {
      lifecycle: { init: "init", destroy: "destroy" },
    }, "export function init() { throw new Error('boom'); }\nexport function destroy() { throw new Error('unused'); }\n");
    const warnings: string[] = [];
    const runtime = await loadUnifiedPlugins({ dirs: [tmp], warn: (msg) => warnings.push(msg) });

    await expect(runtime.init()).resolves.toBeUndefined();
    await expect(runtime.stop()).resolves.toBeUndefined();

    expect(warnings).toEqual(["[unified-plugin] lifecycle-fail.init failed: boom"]);
  });
});
