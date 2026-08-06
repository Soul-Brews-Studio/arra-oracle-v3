import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadUnifiedPlugins } from "../../src/plugins/unified-loader.ts";
import { pluginDir } from "./_fixtures.ts";

const tmp = mkdtempSync(join(tmpdir(), "arra-unified-surfaces-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("loadUnifiedPlugins", () => {
  test("registers metadata for every unified runtime surface", async () => {
    pluginDir(tmp, "surface-pack", {
      mcpTools: [{ name: "oracle_surface", description: "tool", inputSchema: {}, handler: "tool" }],
      apiRoutes: [{ path: "/api/surface", handler: "default" }],
      proxy: [{ path: "/api/proxy", targetEnv: "SURFACE_PROXY_URL" }],
      server: { command: "bun", autostart: false },
      menu: [{ label: "Surface", path: "/surface" }],
      cliSubcommands: [{ command: "surface", help: "surface" }],
    });
    const runtime = await loadUnifiedPlugins({ dirs: [tmp] });
    expect(runtime.mcpTools).toHaveLength(1);
    expect(runtime.routes).toHaveLength(3);
    expect(runtime.servers).toHaveLength(1);
    expect(runtime.menu).toHaveLength(1);
    expect(runtime.cliSubcommands).toHaveLength(1);
  });
});
