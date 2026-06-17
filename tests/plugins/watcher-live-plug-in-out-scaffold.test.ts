import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Elysia } from "elysia";
import { loadUnifiedPlugins } from "../../src/plugins/unified-loader.ts";
import { createUnifiedPluginRouteMount, createUnifiedRuntimeRef } from "../../src/plugins/runtime-routes.ts";
import { watchPluginManifests, type PluginWatchFn } from "../../src/plugins/watcher.ts";
import { createNotFoundMiddleware } from "../../src/middleware/not-found.ts";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tmpRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "arra-plugin-live-watch-"));
  temps.push(dir);
  return dir;
}

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 1000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for plugin watcher reload");
    await Bun.sleep(5);
  }
}

function appFor(ref: ReturnType<typeof createUnifiedRuntimeRef>) {
  const app = new Elysia().get("/api/core", () => ({ source: "core" }));
  app.use(createUnifiedPluginRouteMount(ref, { localRoutes: () => app.routes }));
  app.use(createNotFoundMiddleware(() => app.routes));
  return app;
}

async function getJson(app: Elysia, path: string) {
  const response = await app.handle(new Request(`http://local${path}`));
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}

function writeLivePlugin(dir: string) {
  writeFileSync(join(dir, "index.ts"), `export function hello(ctx) { return { body: { plugin: ctx.plugin } }; }\n`);
  writeFileSync(join(dir, "plugin.json"), JSON.stringify({
    name: "live-watch",
    version: "1.0.0",
    entry: "./index.ts",
    apiRoutes: [{ path: "/api/live-watch/hello", methods: ["GET"], handler: "hello" }],
    mcpTools: [{ name: "live_watch_tool", description: "Live watch tool", inputSchema: {}, handler: "hello" }],
  }, null, 2));
}

describe("watchPluginManifests live plug-in/out scaffold", () => {
  test("drops plugin.json live and removes it without remounting the app", async () => {
    const root = tmpRoot();
    const plugin = join(root, "live-watch");
    mkdirSync(plugin, { recursive: true });

    const runtime = await loadUnifiedPlugins({ dirs: [root] });
    const ref = createUnifiedRuntimeRef(runtime);
    const app = appFor(ref);
    const reloads: string[][] = [];
    let emit: ((event: string, filename: string | Buffer | null) => void) | undefined;

    const watch: PluginWatchFn = (path, options, listener) => {
      expect(path).toBe(root);
      expect(options).toEqual({ recursive: true, persistent: false });
      emit = listener;
      return { close: () => undefined };
    };
    const watcher = watchPluginManifests({
      dirs: [root],
      debounceMs: 1,
      watch,
      onReload: async (next) => {
        await ref.current.stop();
        await next.init();
        ref.current = next;
        reloads.push(next.pluginStatuses().map((status) => status.name).sort());
      },
    });
    if (!emit) throw new Error("watcher did not register");

    try {
      expect((await getJson(app, "/api/live-watch/hello")).response.status).toBe(404);
      expect(ref.current.mcpTools.map((tool) => tool.name)).toEqual([]);

      writeLivePlugin(plugin);
      emit("rename", "live-watch/plugin.json");
      await waitFor(() => reloads.length === 1);

      expect(reloads[0]).toEqual(["live-watch"]);
      expect((await getJson(app, "/api/live-watch/hello")).body).toEqual({ plugin: "live-watch" });
      expect(ref.current.mcpTools.map((tool) => tool.name)).toEqual(["live_watch_tool"]);

      rmSync(join(plugin, "plugin.json"));
      emit("rename", "live-watch/plugin.json");
      await waitFor(() => reloads.length === 2);

      expect(reloads[1]).toEqual([]);
      expect((await getJson(app, "/api/live-watch/hello")).response.status).toBe(404);
      expect(ref.current.mcpTools.map((tool) => tool.name)).toEqual([]);
      expect((await getJson(app, "/api/core")).body).toEqual({ source: "core" });
    } finally {
      watcher.close();
    }
  });
});
