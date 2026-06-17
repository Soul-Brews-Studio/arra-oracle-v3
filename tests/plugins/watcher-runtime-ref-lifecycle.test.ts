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

function servers(label: string, events: string[]): UnifiedServerRuntime {
  return {
    started: 0,
    stop: async () => {
      events.push(`${label}:servers-stop`);
    },
  };
}

async function startServers(nextServers: UnifiedRuntime["servers"], events: string[]) {
  const label = nextServers[0]?.plugin ?? "none";
  events.push(`${label}:servers-start`);
  return servers(label, events);
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
});
