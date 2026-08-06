import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { invokePlugin } from "../../../cli/src/plugin/invoke.ts";
import { loaded, writeModule } from "./_fixtures.ts";

const tmp = mkdtempSync(join(tmpdir(), "arra-invoke-undefined-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("invokePlugin", () => {
  test("normalizes undefined handler results to ok", async () => {
    const entryPath = writeModule(join(tmp, "index.ts"), "export default () => undefined;\n");
    const result = await invokePlugin({ ...loaded(), entryPath }, { source: "cli", args: [] });
    expect(result).toEqual({ ok: true });
  });
});
