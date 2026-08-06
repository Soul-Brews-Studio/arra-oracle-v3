import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadUnifiedPlugins } from "../../src/plugins/unified-loader.ts";
import { handleWith, pluginDir } from "./_fixtures.ts";

const tmp = mkdtempSync(join(tmpdir(), "arra-unified-api-missing-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("unified plugin API routes", () => {
  test("returns structured HTTP failures for missing handlers", async () => {
    pluginDir(tmp, "api-missing", {
      apiRoutes: [{ path: "/api/missing", handler: "missing" }],
    }, "export const noop = true;\n");
    const runtime = await loadUnifiedPlugins({ dirs: [tmp] });
    const response = await handleWith(runtime.routes, new Request("http://local/api/missing"));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, error: "handler not found: missing" });
  });
});
