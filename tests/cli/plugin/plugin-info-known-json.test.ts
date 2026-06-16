import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runCli, tryParseJson } from "../_run.ts";
import { seedOraclePlugin } from "./_cli_commands.ts";

const fakeHome = mkdtempSync(join(tmpdir(), "arra-plugin-info-known-"));
afterAll(() => rmSync(fakeHome, { recursive: true, force: true }));

describe("arra-cli plugin info", () => {
  test("prints known plugin manifests as JSON", async () => {
    seedOraclePlugin(fakeHome, "demo", { version: "0.1.0" });
    const result = await runCli(["plugin", "info", "demo"], { HOME: fakeHome });
    const data = tryParseJson(result.stdout) as
      | { name: string; manifest: { name: string; version: string } | null }
      | null;
    expect(result.code).toBe(0);
    expect(data?.name).toBe("demo");
    expect(data?.manifest?.version).toBe("0.1.0");
  }, 15_000);
});
