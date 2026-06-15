import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runCli } from "../_run.ts";

const fakeHome = mkdtempSync(join(tmpdir(), "arra-plugin-info-unknown-"));
afterAll(() => rmSync(fakeHome, { recursive: true, force: true }));

describe("arra-cli plugin info", () => {
  test("exits with not found for unknown plugins", async () => {
    const result = await runCli(["plugin", "info", "no-such-plugin"], { HOME: fakeHome });
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/not found/);
  }, 10_000);
});
