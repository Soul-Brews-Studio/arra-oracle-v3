import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { invokePlugin } from "../../../cli/src/plugin/invoke.ts";
import { loaded, writeModule } from "./_fixtures.ts";

const tmp = mkdtempSync(join(tmpdir(), "arra-invoke-missing-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("invokePlugin", () => {
  test("reports a missing default handler", async () => {
    const entryPath = writeModule(join(tmp, "index.ts"), "export const nope = true;\n");
    const result = await invokePlugin({ ...loaded(), entryPath }, { source: "cli", args: [] });
    expect(result).toEqual({ ok: false, error: "plugin demo: handler must be a function" });
  });
});
