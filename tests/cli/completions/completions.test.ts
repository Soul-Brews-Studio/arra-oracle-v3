import { describe, expect, test } from "bun:test";
import { runCli } from "../_run.ts";

describe("arra completions", () => {
  for (const shell of ["bash", "zsh", "fish"] as const) {
    test(`${shell} emits a non-empty completion script with known commands`, async () => {
      const result = await runCli(["completions", shell]);
      expect(result.code).toBe(0);
      expect(result.stdout.length).toBeGreaterThan(100);
      expect(result.stdout).toContain("health");
      expect(result.stdout).toContain("config");
      expect(result.stdout).toContain("doctor");
      expect(result.stdout).toContain("plugins");
      expect(result.stdout).toContain("completions");
      expect(result.stdout).toContain("--at");
    }, 15_000);
  }

  test("unknown shell exits non-zero", async () => {
    const result = await runCli(["completions", "powershell"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("unknown shell");
  }, 15_000);
});
