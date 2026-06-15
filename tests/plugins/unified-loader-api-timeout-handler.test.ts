import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadUnifiedPlugins } from "../../src/plugins/unified-loader.ts";
import { handleWith, pluginDir } from "./_fixtures.ts";

const tmp = mkdtempSync(join(tmpdir(), "arra-unified-api-timeout-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("unified plugin API routes", () => {
  test("returns structured HTTP failures when handlers time out", async () => {
    pluginDir(tmp, "api-timeout", {
      apiRoutes: [{ path: "/api/timeout", handler: "default" }],
    }, "export default () => new Promise(() => {});\n");
    const runtime = await loadUnifiedPlugins({ dirs: [tmp], timeoutMs: 5 });
    const response = await handleWith(runtime.routes, new Request("http://local/api/timeout"));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, error: "handler timed out" });
  });
});
