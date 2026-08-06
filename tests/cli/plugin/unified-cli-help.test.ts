import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runCli } from "../_run.ts";

describe("arra-cli unified subcommand help", () => {
  let fakeHome: string;

  beforeAll(() => {
    fakeHome = mkdtempSync(join(tmpdir(), "arra-cli-unified-help-"));
    const dir = join(fakeHome, ".arra", "plugins", "unified-demo");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "plugin.json"), JSON.stringify({
      name: "unified-demo",
      version: "1.0.0",
      entry: "./index.ts",
      sdk: "^0.0.1",
      cliSubcommands: [{ command: "unified-echo", help: "echo via unified manifest" }],
    }, null, 2));
    writeFileSync(join(dir, "index.ts"), "export default () => ({ ok: true });\n");
  });

  afterAll(() => { if (fakeHome) rmSync(fakeHome, { recursive: true, force: true }); });

  test("prints help from cliSubcommands entries", async () => {
    const result = await runCli(["-h", "unified-echo"], { HOME: fakeHome });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("unified-echo — echo via unified manifest");
  }, 15_000);
});
