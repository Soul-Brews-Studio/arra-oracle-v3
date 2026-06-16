import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadUnifiedPlugins } from "../../src/plugins/unified-loader.ts";
import { pluginDir } from "./_fixtures.ts";

const tmp = mkdtempSync(join(tmpdir(), "arra-unified-config-context-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("UnifiedRuntime plugin config context", () => {
  test("passes validated manifest config to plugin handlers", async () => {
    const config = { token: "secret", enabled: true };
    pluginDir(tmp, "config-context", {
      config,
      configSchema: {
        type: "object",
        required: ["token", "enabled"],
        properties: { token: { type: "string" }, enabled: { type: "boolean" } },
      },
      mcpTools: [{ name: "oracle_config_context", description: "tool", inputSchema: {}, handler: "tool" }],
    }, "export function tool(ctx) { return { ok: true, config: ctx.config }; }\n");

    const runtime = await loadUnifiedPlugins({ dirs: [tmp] });

    expect(await runtime.callMcpTool("oracle_config_context")).toEqual({ ok: true, config });
  });
});
