import { describe, expect, test } from "bun:test";
import { createUnifiedRuntimeRef } from "../../src/plugins/runtime-routes.ts";
import { swapUnifiedRuntimeWithLifecycle } from "../../src/plugins/runtime-reload.ts";
import { watchPluginManifests } from "../../src/plugins/watcher.ts";
import type { UnifiedRuntime } from "../../src/plugins/unified-loader.ts";
import type { UnifiedServerRuntime } from "../../src/plugins/unified-server.ts";

type RuntimeStub = UnifiedRuntime & { label: string };

function runtime(label: string, events: string[], initError?: Error): RuntimeStub {
  return {
    label,
    pluginCount: 0,
    routes: [],
    mcpTools: [],
    menu: [],
    cliSubcommands: [],
    servers: [],
    callMcpTool: async () => ({ ok: false }),
    pluginStatuses: () => [{ name: label, status: "ok" }],
    pluginRegistry: () => [],
    init: async () => {
      events.push(`${label}:init`);
      if (initError) throw initError;
    },
    reload: async () => {
      events.push(`${label}:reload`);
    },
    stop: async () => {
      events.push(`${label}:stop`);
    },
  };
}

function servers(label: string, events: string[], stopError?: Error): UnifiedServerRuntime {
  return {
    started: 0,
    stop: async () => {
      events.push(`${label}:servers-stop`);
      if (stopError) throw stopError;
    },
  };
}

async function startServers(nextServers: UnifiedRuntime["servers"], events: string[]) {
  const label = nextServers[0]?.plugin ?? "none";
  events.push(`${label}:servers-start`);
  return servers(label, events);
}

async function waitUntil(predicate: () => boolean) {
  const deadline = Date.now() + 500;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for condition");
    await Bun.sleep(1);
  }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("watchPluginManifests runtimeRef lifecycle", () => {
  test("onReload stops the current runtime, initializes the replacement, and swaps the stable ref", async () => {
    const events: string[] = [];
    const ref = createUnifiedRuntimeRef(runtime("old", events));
    const next = runtime("next", events);
    next.servers.push({ plugin: "next", dir: "/tmp", routePrefix: "/api/plugins/next/server", command: "bun" });
    const state = { servers: servers("old", events) };

    const watcher = watchPluginManifests({
      dirs: [],
      loader: async () => next,
      onReload: (runtime) => swapUnifiedRuntimeWithLifecycle(ref, state, runtime, {
        startServers: (nextServers) => startServers(nextServers, events),
      }),
    });

    const loaded = await watcher.reload();

    expect(loaded).toBe(next);
    expect(ref.current).toBe(next);
    expect(events).toEqual(["old:stop", "old:servers-stop", "next:init", "next:servers-start"]);
    watcher.close();
  });

  test("restores the previous lifecycle when replacement init fails", async () => {
    const events: string[] = [];
    const previous = runtime("old", events);
    previous.servers.push({ plugin: "old", dir: "/tmp", routePrefix: "/api/plugins/old/server", command: "bun" });
    const ref = createUnifiedRuntimeRef(previous);
    const next = runtime("next", events, new Error("init failed"));
    const state = { servers: servers("old", events) };

    const watcher = watchPluginManifests({
      dirs: [],
      loader: async () => next,
      onReload: (runtime) => swapUnifiedRuntimeWithLifecycle(ref, state, runtime, {
        startServers: (nextServers) => startServers(nextServers, events),
      }),
    });

    await expect(watcher.reload()).rejects.toThrow("init failed");

    expect(ref.current).toBe(previous);
    expect(events).toEqual([
      "old:stop",
      "old:servers-stop",
      "next:init",
      "next:stop",
      "old:init",
      "old:servers-start",
    ]);
    watcher.close();
  });

  test("restores the previous runtime when previous servers fail to stop", async () => {
    const events: string[] = [];
    const previous = runtime("old", events);
    const ref = createUnifiedRuntimeRef(previous);
    const next = runtime("next", events);
    const state = { servers: servers("old", events, new Error("server stop failed")) };

    const watcher = watchPluginManifests({
      dirs: [],
      loader: async () => next,
      onReload: (runtime) => swapUnifiedRuntimeWithLifecycle(ref, state, runtime),
    });

    await expect(watcher.reload()).rejects.toThrow("server stop failed");

    expect(ref.current).toBe(previous);
    expect(events).toEqual(["old:stop", "old:servers-stop", "old:init"]);
    watcher.close();
  });

  test("serializes overlapping reloads so lifecycle swaps cannot interleave", async () => {
    const events: string[] = [];
    const gate = deferred();
    let id = 0;
    const watcher = watchPluginManifests({
      dirs: [],
      loader: async () => runtime(`next-${++id}`, events),
      onReload: async (loaded) => {
        const label = (loaded as RuntimeStub).label;
        events.push(`${label}:onReload-start`);
        if (label === "next-1") await gate.promise;
        events.push(`${label}:onReload-end`);
      },
    });

    const first = watcher.reload();
    await waitUntil(() => events.includes("next-1:onReload-start"));
    const second = watcher.reload();
    await Bun.sleep(10);
    expect(events).toEqual(["next-1:onReload-start"]);

    gate.resolve();
    await Promise.all([first, second]);

    expect(events).toEqual([
      "next-1:onReload-start",
      "next-1:onReload-end",
      "next-2:onReload-start",
      "next-2:onReload-end",
    ]);
    watcher.close();
  });
});
