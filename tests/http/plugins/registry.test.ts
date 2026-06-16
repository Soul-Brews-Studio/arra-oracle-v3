import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Elysia } from "elysia";
import { loadUnifiedPlugins } from "../../../src/plugins/unified-loader.ts";
import { createPluginsRouter } from "../../../src/routes/plugins/index.ts";
import { pluginDir } from "../../plugins/_fixtures.ts";

const tmp = mkdtempSync(join(tmpdir(), "arra-plugin-registry-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("GET /api/plugins", () => {
  test("returns loaded plugin status, version, and surfaces", async () => {
    pluginDir(tmp, "registry-pack", {
      description: "Registry fixture",
      mcpTools: [{ name: "registry_tool", description: "tool", inputSchema: {}, handler: "tool" }],
      apiRoutes: [{ path: "/api/registry-pack", methods: ["GET"], handler: "api" }],
      proxy: [{ path: "/api/registry-pack/server", targetEnv: "REGISTRY_PACK_URL" }],
      menu: [{ label: "Registry", path: "/registry", group: "tools", order: 4 }],
      cliSubcommands: [{ command: "registry", help: "Registry command", handler: "cli" }],
      exportFormats: [{ name: "registry", handler: "exportRegistry" }],
    });
    const runtime = await loadUnifiedPlugins({ dirs: [tmp] });
    const app = new Elysia().use(createPluginsRouter({ dir: tmp, registry: runtime.pluginRegistry }));

    const response = await app.handle(new Request("http://local/api/plugins"));
    expect(response.status).toBe(200);
    const body = await response.json() as {
      count: number;
      plugins: Array<Record<string, unknown>>;
    };

    expect(body.count).toBe(1);
    expect(body.plugins[0]).toMatchObject({
      name: "registry-pack",
      version: "1.0.0",
      status: "ok",
      surfaces: ["mcpTools", "apiRoutes", "proxy", "menu", "cliSubcommands", "exportFormats"],
      description: "Registry fixture",
      apiRoutes: [{ path: "/api/registry-pack", methods: ["GET"] }],
      proxy: [{ path: "/api/registry-pack/server", targetEnv: "REGISTRY_PACK_URL" }],
      mcpTools: [{ name: "registry_tool", description: "tool" }],
      cliSubcommands: [{ command: "registry", help: "Registry command" }],
      exportFormats: [{ name: "registry", extension: "registry" }],
    });
    expect(Number.isNaN(Date.parse(String(body.plugins[0].modified)))).toBe(false);
  });
});
