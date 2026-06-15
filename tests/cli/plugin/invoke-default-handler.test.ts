import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { invokePlugin } from "../../../cli/src/plugin/invoke.ts";
import { loaded, writeModule } from "./_fixtures.ts";

const tmp = mkdtempSync(join(tmpdir(), "arra-invoke-default-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("invokePlugin", () => {
  test("calls a default handler with InvokeContext", async () => {
    const entryPath = writeModule(join(tmp, "index.ts"), "export default (ctx) => ({ ok: true, output: ctx.args.join(',') });\n");
    const result = await invokePlugin({ ...loaded(), entryPath }, { source: "cli", args: ["a", "b"] });
    expect(result).toEqual({ ok: true, output: "a,b" });
  });
});
