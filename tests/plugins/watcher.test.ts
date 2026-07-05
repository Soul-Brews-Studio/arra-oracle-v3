import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { watchPluginManifests, type PluginWatchFn } from "../../src/plugins/watcher.ts";
import { pluginDir } from "./_fixtures.ts";

const tmp = mkdtempSync(join(tmpdir(), "arra-plugin-watcher-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 500;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for watcher reload");
    await Bun.sleep(5);
  }
}

describe("watchPluginManifests", () => {
  test("reloads plugin runtime when plugin.json changes", async () => {
    pluginDir(tmp, "first", {});
    let emit: ((event: string, filename: string | Buffer | null) => void) | undefined;
    let closed = 0;
    const watch: PluginWatchFn = (path, options, listener) => {
      expect(path).toBe(tmp);
      expect(options).toEqual({ recursive: true, persistent: false });
      emit = listener;
      return { close: () => closed += 1 };
    };
    const reloads: string[][] = [];
    const watcher = watchPluginManifests({
      dirs: [tmp],
      debounceMs: 1,
      watch,
      onReload: (runtime) => {
        reloads.push(runtime.pluginStatuses().map((status) => status.name).sort());
      },
    });

    pluginDir(tmp, "second", {});
    if (!emit) throw new Error("watcher did not register");
    emit("change", "second/plugin.json");
    await waitFor(() => reloads.length === 1);

    expect(reloads[0]).toEqual(["first", "second"]);
    watcher.close();
    expect(closed).toBe(1);
  });
});
