import { describe, expect, test } from "bun:test";
import { PluginEventBus, pluginEventBus, type PluginEventHandler } from "../../src/plugins/event-bus.ts";

describe("PluginEventBus", () => {
  test("routes typed plugin lifecycle events between listeners", async () => {
    const bus = new PluginEventBus();
    const received: string[] = [];
    const offLoaded = bus.on("plugin:loaded", (event) => {
      received.push(`loaded:${event.plugin}:${event.dir}`);
    });
    bus.on("plugin:error", async (event) => {
      received.push(`error:${event.plugin}:${event.phase}:${event.message}`);
    });
    const destroyed: PluginEventHandler<"plugin:destroyed"> = (event) => {
      received.push(`destroyed:${event.plugin}:${event.reason}`);
    };
    bus.on("plugin:destroyed", destroyed);

    expect(await bus.emit("plugin:loaded", { plugin: "alpha", dir: "/plugins/alpha" })).toBe(1);
    expect(await bus.emit("plugin:error", {
      plugin: "alpha",
      phase: "init",
      error: new Error("boom"),
      message: "boom",
    })).toBe(1);
    expect(await bus.emit("plugin:destroyed", { plugin: "alpha", reason: "shutdown" })).toBe(1);

    offLoaded();
    bus.off("plugin:destroyed", destroyed);
    expect(await bus.emit("plugin:loaded", { plugin: "alpha" })).toBe(0);
    expect(await bus.emit("plugin:destroyed", { plugin: "alpha" })).toBe(0);
    expect(received).toEqual([
      "loaded:alpha:/plugins/alpha",
      "error:alpha:init:boom",
      "destroyed:alpha:shutdown",
    ]);
    expect(pluginEventBus).toBeInstanceOf(PluginEventBus);
  });
});
