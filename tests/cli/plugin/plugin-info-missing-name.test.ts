import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runCli } from "../_run.ts";

const fakeHome = mkdtempSync(join(tmpdir(), "arra-plugin-info-missing-"));
afterAll(() => rmSync(fakeHome, { recursive: true, force: true }));

describe("arra-cli plugin info", () => {
  test("prints usage when no plugin name is provided", async () => {
    const result = await runCli(["plugin", "info"], { HOME: fakeHome });
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/usage/i);
  }, 10_000);
});
