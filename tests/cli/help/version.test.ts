import { describe, expect, test } from "bun:test";
import pkg from "../../../package.json" with { type: "json" };
import { runCli } from "../_run.ts";

describe("arra-cli --version", () => {
  test("prints the root package calver", async () => {
    const result = await runCli(["--version"]);

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(`arra-cli v${pkg.version}`);
    expect(result.stdout).not.toContain("0.0.1");
  }, 15_000);
});
