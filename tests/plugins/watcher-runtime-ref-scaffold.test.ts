import { describe, expect, test } from "bun:test";
import { watchPluginManifests } from "../../src/plugins/watcher.ts";
import type { UnifiedRuntime } from "../../src/plugins/unified-loader.ts";

type RuntimeStub = UnifiedRuntime & { label: string };
type RuntimeRef = { current: RuntimeStub };

function runtime(label: string, events: string[]): RuntimeStub {
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
    },
    reload: async () => {
      events.push(`${label}:reload`);
    },
    stop: async () => {
      events.push(`${label}:stop`);
    },
  };
}

async function reloadRuntimeRef(ref: RuntimeRef, next: UnifiedRuntime, events: string[]) {
  const previous = ref.current;
  await previous.stop();
  await next.init();
  ref.current = next as RuntimeStub;
  events.push(`swap:${previous.label}->${ref.current.label}`);
}

describe("watchPluginManifests runtimeRef scaffold", () => {
  test("awaits onReload so Slice 5b can stop, init, then swap the stable runtime ref", async () => {
    const events: string[] = [];
    const ref: RuntimeRef = { current: runtime("old", events) };
    const next = runtime("next", events);

    const watcher = watchPluginManifests({
      dirs: [],
      loader: async () => next,
      onReload: (runtime) => reloadRuntimeRef(ref, runtime, events),
    });

    const loaded = await watcher.reload();

    expect(loaded).toBe(next);
    expect(ref.current).toBe(next);
    expect(events).toEqual(["old:stop", "next:init", "swap:old->next"]);
    watcher.close();
  });
});
