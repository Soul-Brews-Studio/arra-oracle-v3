import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runCli, tryParseJson } from "../_run.ts";

const fakeHome = mkdtempSync(join(tmpdir(), "arra-plugin-list-empty-"));
afterAll(() => rmSync(fakeHome, { recursive: true, force: true }));

describe("arra-cli plugin list", () => {
  test("prints an empty plugin array for a fresh home", async () => {
    const result = await runCli(["plugin", "list"], { HOME: fakeHome });
    const data = tryParseJson(result.stdout) as { dir: string; plugins: unknown[] } | null;
    expect(result.code).toBe(0);
    expect(data?.plugins).toEqual([]);
    expect(data?.dir).toContain(".oracle/plugins");
  }, 15_000);
});
