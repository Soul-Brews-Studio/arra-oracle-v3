import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadUnifiedPlugins } from "../../src/plugins/unified-loader.ts";
import { pluginDir } from "./_fixtures.ts";

const tmp = mkdtempSync(join(tmpdir(), "arra-unified-mcp-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("UnifiedRuntime.callMcpTool", () => {
  test("invokes MCP tool handlers with args and body", async () => {
    pluginDir(tmp, "mcp-pack", {
      mcpTools: [{ name: "oracle_mcp_pack", description: "tool", inputSchema: {}, handler: "tool" }],
    }, "export function tool(ctx) { return { ok: true, body: { args: ctx.args, body: ctx.body } }; }\n");
    const runtime = await loadUnifiedPlugins({ dirs: [tmp] });
    expect(await runtime.callMcpTool("oracle_mcp_pack", { q: 1 })).toEqual({
      ok: true,
      body: { args: [{ q: 1 }], body: { q: 1 } },
    });
  });
});
