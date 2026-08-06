import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runCli, tryParseJson } from "../_run.ts";
import { getEnabledToolNames, loadToolGroupConfig } from "../../../src/config/tool-groups.ts";

function writeJson(path: string, value: unknown) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
}

describe("arra plugins CLI", () => {
  let root: string;
  let env: Record<string, string>;

  beforeEach(() => {
    root = join(tmpdir(), `arra-plugins-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(root, { recursive: true });
    env = {
      HOME: join(root, "home"),
      ORACLE_REPO_ROOT: root,
      ORACLE_DATA_DIR: join(root, "data"),
    };
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("list reads repo plugins.json and shows enabled state", async () => {
    writeJson(join(root, "plugins.json"), {
      plugins: [
        { name: "trace", enabled: false, tier: "standard", weight: 1 },
        { name: "dig", enabled: true, tier: "standard", weight: 2 },
      ],
    });

    const result = await runCli(["plugins", "list", "--json"], env);

    expect(result.code).toBe(0);
    const data = tryParseJson(result.stdout) as { source: string; path: string; plugins: Array<{ name: string; enabled: boolean; weight: number }> } | null;
    expect(data?.source).toBe("repo");
    expect(data?.path).toBe(join(root, "plugins.json"));
    expect(data?.plugins.find(p => p.name === "trace")?.enabled).toBe(false);
    expect(data?.plugins.find(p => p.name === "dig")?.enabled).toBe(true);
  }, 15_000);

  test("plugins with no subcommand defaults to list", async () => {
    const result = await runCli(["plugins", "--json"], env);
    expect(result.code).toBe(0);
    const data = tryParseJson(result.stdout) as { source: string; plugins: Array<{ name: string }> } | null;
    expect(data?.source).toBe("default");
    expect(data?.plugins.some(p => p.name === "trace")).toBe(true);
  }, 15_000);

  test("disable and enable persist to the manifest the MCP loader honors", async () => {
    const disable = await runCli(["plugins", "disable", "trace", "--json"], env);
    expect(disable.code).toBe(0);
    let manifest = JSON.parse(readFileSync(join(root, "plugins.json"), "utf8"));
    expect(manifest.plugins.find((p: any) => p.name === "trace")?.enabled).toBe(false);
    let config = loadToolGroupConfig(root);
    expect(getEnabledToolNames(config)).not.toContain("oracle_trace");

    const enable = await runCli(["plugins", "enable", "trace", "--json"], env);
    expect(enable.code).toBe(0);
    manifest = JSON.parse(readFileSync(join(root, "plugins.json"), "utf8"));
    expect(manifest.plugins.find((p: any) => p.name === "trace")?.enabled).toBe(true);
    config = loadToolGroupConfig(root);
    expect(getEnabledToolNames(config)).toContain("oracle_trace");
  }, 15_000);

  test("unknown plugin exits non-zero without mutating manifest", async () => {
    const result = await runCli(["plugins", "disable", "not-a-plugin"], env);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Unknown plugin");
  }, 15_000);
});
