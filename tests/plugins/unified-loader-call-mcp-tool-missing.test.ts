import { describe, expect, test } from "bun:test";
import { loadUnifiedPlugins } from "../../src/plugins/unified-loader.ts";

describe("UnifiedRuntime.callMcpTool", () => {
  test("reports missing MCP tools", async () => {
    const runtime = await loadUnifiedPlugins({ dirs: ["/tmp/no-such-unified-plugin-dir"] });
    expect(await runtime.callMcpTool("missing")).toEqual({ ok: false, error: "MCP tool not found: missing" });
  });
});
