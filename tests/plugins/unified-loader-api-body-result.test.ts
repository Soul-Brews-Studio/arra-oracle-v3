import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadUnifiedPlugins } from "../../src/plugins/unified-loader.ts";
import { handleWith, pluginDir } from "./_fixtures.ts";

const tmp = mkdtempSync(join(tmpdir(), "arra-unified-api-body-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("unified plugin API routes", () => {
  test("returns explicit body values from handler results", async () => {
    pluginDir(tmp, "api-body", {
      apiRoutes: [{ path: "/api/body", methods: ["POST"], handler: "default" }],
    }, "export default (ctx) => ({ ok: true, body: { method: ctx.request.method, body: ctx.body } });\n");
    const runtime = await loadUnifiedPlugins({ dirs: [tmp] });
    const response = await handleWith(runtime.routes, new Request("http://local/api/body", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true }),
    }));
    expect(await response.json()).toEqual({ method: "POST", body: { ok: true } });
  });
});
