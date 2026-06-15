import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadUnifiedPlugins } from "../../src/plugins/unified-loader.ts";
import { handleWith, pluginDir } from "./_fixtures.ts";

const tmp = mkdtempSync(join(tmpdir(), "arra-unified-api-response-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("unified plugin API routes", () => {
  test("passes Response handler results through unchanged", async () => {
    pluginDir(tmp, "api-response", {
      apiRoutes: [{ path: "/api/response", handler: "default" }],
    }, "export default () => new Response('custom', { status: 202 });\n");
    const runtime = await loadUnifiedPlugins({ dirs: [tmp] });
    const response = await handleWith(runtime.routes, new Request("http://local/api/response"));
    expect(response.status).toBe(202);
    expect(await response.text()).toBe("custom");
  });
});
