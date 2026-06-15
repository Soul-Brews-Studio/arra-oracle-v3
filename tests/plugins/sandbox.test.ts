import { describe, expect, test } from "bun:test";
import { PluginEventBus, type PluginEventMap } from "../../src/plugins/event-bus.ts";
import { runPluginSandbox } from "../../src/plugins/sandbox.ts";

describe("runPluginSandbox", () => {
  test("returns plugin failures and emits plugin:error without throwing", async () => {
    const bus = new PluginEventBus();
    const events: PluginEventMap["plugin:error"][] = [];
    bus.on("plugin:error", (event) => {
      events.push(event);
    });

    const success = await runPluginSandbox({ plugin: "ok-plugin", phase: "runtime", eventBus: bus }, () => "ok");
    const failure = await runPluginSandbox({ plugin: "bad-plugin", phase: "init", eventBus: bus }, () => {
      throw new Error("boom");
    });
    const throwingBus = {
      emit: async () => {
        throw new Error("observer failed");
      },
    } as Pick<PluginEventBus, "emit">;
    const observerFailure = await runPluginSandbox({ plugin: "observer-plugin", phase: "destroy", eventBus: throwingBus }, () => {
      throw "plain failure";
    });

    expect(success).toEqual({ ok: true, value: "ok" });
    expect(failure).toMatchObject({ ok: false, error: "boom" });
    expect(observerFailure).toMatchObject({ ok: false, error: "plain failure" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ plugin: "bad-plugin", phase: "init", message: "boom" });
    expect(events[0].error).toBeInstanceOf(Error);
  });
});
