import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadUnifiedPlugins } from "../../src/plugins/unified-loader.ts";
import { pluginDir } from "./_fixtures.ts";

const tmp = mkdtempSync(join(tmpdir(), "arra-plugin-deps-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function entry(log: string) {
  return `
    import { appendFileSync } from "node:fs";
    const log = ${JSON.stringify(log)};
    export function init(ctx) {
      appendFileSync(log, \`\${ctx.plugin}\\n\`);
      return { ok: true };
    }
  `;
}

describe("loadUnifiedPlugins dependency resolution", () => {
  test("initializes dependencies before dependent plugins", async () => {
    const log = join(tmp, "init.log");
    pluginDir(tmp, "app", { depends: ["core"], lifecycle: { init: "init" } }, entry(log));
    pluginDir(tmp, "core", { lifecycle: { init: "init" } }, entry(log));

    const runtime = await loadUnifiedPlugins({ dirs: [tmp] });
    await runtime.init();

    expect(readFileSync(log, "utf8").trim().split("\n")).toEqual(["core", "app"]);
  });
});
