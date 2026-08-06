import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadUnifiedPlugins } from "../../src/plugins/unified-loader.ts";
import { pluginDir } from "./_fixtures.ts";

const tmp = mkdtempSync(join(tmpdir(), "arra-unified-load-catch-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("loadUnifiedPlugins", () => {
  test("skips unreadable plugin roots without disabling later roots", async () => {
    const filePath = join(tmp, "not-a-dir");
    const validRoot = join(tmp, "valid-root");
    writeFileSync(filePath, "x");
    mkdirSync(validRoot);
    pluginDir(validRoot, "valid-plugin", { menu: [{ label: "Valid", path: "/valid" }] });
    const warnings: string[] = [];

    const runtime = await loadUnifiedPlugins({ dirs: [filePath, validRoot], warn: (msg) => warnings.push(msg) });

    expect(runtime.menu.map((item) => item.path)).toEqual(["/valid"]);
    expect(warnings[0]).toContain("[unified-plugin] skipped");
    expect(warnings[0]).toContain("not-a-dir");
  });
});
