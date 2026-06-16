import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { watchPluginManifests } from "../../src/plugins/watcher.ts";

const tmp = mkdtempSync(join(tmpdir(), "arra-plugin-watch-failure-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("watchPluginManifests", () => {
  test("warns when a plugin directory cannot be watched", () => {
    const warnings: string[] = [];
    const watcher = watchPluginManifests({
      dirs: [tmp],
      onReload: () => undefined,
      warn: (message) => warnings.push(message),
      watch: () => {
        throw new Error("watch unavailable");
      },
    });

    expect(warnings).toEqual([`[unified-plugin-watcher] watch disabled for ${tmp}: watch unavailable`]);
    watcher.close();
  });
});
