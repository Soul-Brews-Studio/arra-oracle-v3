import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadUnifiedPlugins } from "../../src/plugins/unified-loader.ts";
import { pluginDir } from "./_fixtures.ts";

const tmp = mkdtempSync(join(tmpdir(), "arra-unified-lifecycle-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("UnifiedRuntime plugin lifecycle hooks", () => {
  test("calls init on startup and destroy on shutdown", async () => {
    const log = join(tmp, "lifecycle.log");
    pluginDir(tmp, "lifecycle-pack", {
      lifecycle: { init: "init", destroy: "destroy" },
    }, `
      import { appendFileSync } from "node:fs";
      const log = ${JSON.stringify(log)};
      export function init(ctx) {
        appendFileSync(log, \`init:\${ctx.plugin}:\${ctx.source}\\n\`);
        return { ok: true };
      }
      export function destroy(ctx) {
        appendFileSync(log, \`destroy:\${ctx.plugin}:\${ctx.source}\\n\`);
        return { ok: true };
      }
    `);

    const runtime = await loadUnifiedPlugins({ dirs: [tmp] });
    await runtime.init();
    await runtime.stop();

    expect(readFileSync(log, "utf8").trim().split("\n")).toEqual([
      "init:lifecycle-pack:init",
      "destroy:lifecycle-pack:destroy",
    ]);
  });
});
