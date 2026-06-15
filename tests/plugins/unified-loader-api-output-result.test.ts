import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadUnifiedPlugins } from "../../src/plugins/unified-loader.ts";
import { handleWith, pluginDir } from "./_fixtures.ts";

const tmp = mkdtempSync(join(tmpdir(), "arra-unified-api-output-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("unified plugin API routes", () => {
  test("wraps output handler results for HTTP responses", async () => {
    pluginDir(tmp, "api-output", {
      apiRoutes: [{ path: "/api/output", handler: "default" }],
    }, "export default () => ({ ok: true, output: 'hello' });\n");
    const runtime = await loadUnifiedPlugins({ dirs: [tmp] });
    const response = await handleWith(runtime.routes, new Request("http://local/api/output"));
    expect(await response.json()).toEqual({ ok: true, output: "hello" });
  });
});
