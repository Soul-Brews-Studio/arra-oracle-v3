import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { watchPluginManifests, type PluginWatchFn } from "../../src/plugins/watcher.ts";

const tmp = mkdtempSync(join(tmpdir(), "arra-plugin-watcher-fail-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 500;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for watcher warning");
    await Bun.sleep(5);
  }
}

describe("watchPluginManifests", () => {
  test("warns when a scheduled reload fails", async () => {
    let emit: ((event: string, filename: string | Buffer | null) => void) | undefined;
    const warnings: string[] = [];
    const watch: PluginWatchFn = (_path, _options, listener) => {
      emit = listener;
      return { close: () => undefined };
    };
    const watcher = watchPluginManifests({
      dirs: [tmp],
      debounceMs: 1,
      loader: async () => {
        throw new Error("boom");
      },
      onReload: () => {
        throw new Error("should not reload");
      },
      warn: (message) => warnings.push(message),
      watch,
    });

    if (!emit) throw new Error("watcher did not register");
    emit("change", Buffer.from("plugin.json"));
    await waitFor(() => warnings.length === 1);

    expect(warnings).toEqual(["[unified-plugin-watcher] reload failed: boom"]);
    watcher.close();
  });
});
