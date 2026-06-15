import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runCli } from "../_run.ts";

function writeUnifiedPlugin(root: string): void {
  const dir = join(root, ".arra", "plugins", "unified-demo");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "plugin.json"), JSON.stringify({
    name: "unified-demo",
    version: "1.0.0",
    entry: "./index.ts",
    sdk: "^0.0.1",
    description: "Unified manifest CLI fixture",
    cliSubcommands: [
      {
        command: "unified-echo",
        help: "echo via unified manifest",
        handler: "echoCli",
      },
    ],
  }, null, 2));
  writeFileSync(join(dir, "index.ts"), `
export function echoCli(ctx) {
  ctx.writer?.("writer:" + ctx.args.join(" "));
  return { ok: true, output: "output:" + ctx.args.join("|") };
}
`);
}

describe("arra-cli unified manifest CLI subcommands", () => {
  let fakeHome: string;

  beforeAll(() => {
    fakeHome = mkdtempSync(join(tmpdir(), "arra-cli-unified-"));
    writeUnifiedPlugin(fakeHome);
  });

  afterAll(() => {
    if (fakeHome) rmSync(fakeHome, { recursive: true, force: true });
  });

  test("dispatches a cliSubcommands handler with InvokeContext", async () => {
    const result = await runCli(["unified-echo", "alpha", "beta"], {
      HOME: fakeHome,
      XDG_CONFIG_HOME: join(fakeHome, "xdg"),
    });

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("writer:alpha beta");
    expect(result.stdout).toContain("output:alpha|beta");
  }, 15_000);

  test("shows help for cliSubcommands entries", async () => {
    const result = await runCli(["-h", "unified-echo"], {
      HOME: fakeHome,
      XDG_CONFIG_HOME: join(fakeHome, "xdg"),
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("unified-echo — echo via unified manifest");
  }, 15_000);
});
