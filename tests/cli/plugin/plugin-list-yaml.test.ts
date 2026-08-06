import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runCli, tryParseJson } from "../_run.ts";

const fakeHome = mkdtempSync(join(tmpdir(), "arra-plugin-list-yaml-"));
afterAll(() => rmSync(fakeHome, { recursive: true, force: true }));

describe("arra-cli plugin list", () => {
  test("prints YAML when --yml is passed", async () => {
    const result = await runCli(["plugin", "list", "--yml"], { HOME: fakeHome });
    expect(result.code).toBe(0);
    expect(tryParseJson(result.stdout)).toBeNull();
    expect(result.stdout).toMatch(/plugins:|dir:/);
  }, 15_000);
});
