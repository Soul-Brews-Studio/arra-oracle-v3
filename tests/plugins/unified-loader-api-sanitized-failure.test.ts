import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadUnifiedPlugins } from "../../src/plugins/unified-loader.ts";
import { handleWith, pluginDir } from "./_fixtures.ts";

const tmp = mkdtempSync(join(tmpdir(), "arra-unified-api-sanitized-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("unified plugin API failure hardening", () => {
  test("sanitizes malformed failure status and headers", async () => {
    pluginDir(tmp, "api-sanitized", {
      apiRoutes: [{ path: "/api/sanitized", handler: "default" }],
    }, `export default () => ({
      ok: false,
      status: 204,
      error: '',
      headers: { 'x-plugin-error': 'kept', 'bad header': 'drop', 'x-number': 42 },
    });\n`);

    const runtime = await loadUnifiedPlugins({ dirs: [tmp] });
    const response = await handleWith(runtime.routes, new Request("http://local/api/sanitized"));

    expect(response.status).toBe(500);
    expect(response.headers.get("x-plugin-error")).toBe("kept");
    expect(response.headers.get("x-number")).toBeNull();
    expect(await response.json()).toEqual({ ok: false, error: "plugin failed" });
  });
});
