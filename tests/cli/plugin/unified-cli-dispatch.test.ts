import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runCli } from "../_run.ts";

describe("arra-cli unified subcommand dispatch", () => {
  let fakeHome: string;

  beforeAll(() => {
    fakeHome = mkdtempSync(join(tmpdir(), "arra-cli-unified-"));
    const dir = join(fakeHome, ".arra", "plugins", "unified-demo");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "plugin.json"), JSON.stringify({
      name: "unified-demo",
      version: "1.0.0",
      entry: "./index.ts",
      sdk: "^0.0.1",
      cliSubcommands: [{ command: "unified-echo", help: "echo", handler: "echoCli" }],
    }, null, 2));
    writeFileSync(join(dir, "index.ts"), `
export function echoCli(ctx) {
  ctx.writer?.("writer:" + ctx.args.join(" "));
  return { ok: true, output: "output:" + ctx.args.join("|") };
}
`);
  });

  afterAll(() => { if (fakeHome) rmSync(fakeHome, { recursive: true, force: true }); });

  test("passes args and writer through InvokeContext", async () => {
    const result = await runCli(["unified-echo", "alpha", "beta"], { HOME: fakeHome });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("writer:alpha beta");
    expect(result.stdout).toContain("output:alpha|beta");
  }, 15_000);
});
