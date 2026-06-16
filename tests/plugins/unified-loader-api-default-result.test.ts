import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadUnifiedPlugins } from "../../src/plugins/unified-loader.ts";
import { handleWith, pluginDir } from "./_fixtures.ts";

const tmp = mkdtempSync(join(tmpdir(), "arra-unified-api-default-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("unified plugin API routes", () => {
  test("returns default metadata when no route handler is declared", async () => {
    pluginDir(tmp, "api-default", { apiRoutes: [{ path: "/api/default" }] });
    const runtime = await loadUnifiedPlugins({ dirs: [tmp] });
    const response = await handleWith(runtime.routes, new Request("http://local/api/default"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, plugin: "api-default", source: "api" });
  });
});
