import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runCli } from "../_run.ts";

let roots: string[] = [];

function isolatedEnv(): Record<string, string> {
  const root = mkdtempSync(join(tmpdir(), "arra-cli-help-"));
  roots.push(root);
  return {
    HOME: join(root, "home"),
    ORACLE_DATA_DIR: join(root, "data"),
    ORACLE_REPO_ROOT: root,
  };
}

async function cliHelp(args: string[]): Promise<string> {
  const result = await runCli(args, isolatedEnv());
  expect(result.code).toBe(0);
  return result.stdout;
}

describe("arra-cli help output", () => {
  afterEach(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
    roots = [];
  });

  test("top-level help includes usage, examples, and global flags", async () => {
    const stdout = await cliHelp(["--help"]);

    expect(stdout).toContain("Usage: arra-cli <command> [args...]");
    expect(stdout).toContain("Global flags:");
    expect(stdout).toContain("--version");
    expect(stdout).toContain("Examples:");
    expect(stdout).toContain("arra-cli doctor --json");
  }, 15_000);

  test("builtin subcommands include usage and examples", async () => {
    const menu = await cliHelp(["menu", "--help"]);
    const plugins = await cliHelp(["plugins", "--help"]);
    const doctor = await cliHelp(["doctor", "--help"]);
    const config = await cliHelp(["-h", "config"]);
    const menuAdd = await cliHelp(["menu", "add", "--help"]);
    const sessionShow = await cliHelp(["session", "show", "--help"]);
    const pluginInstall = await cliHelp(["plugin", "install", "--help"]);

    expect(menu).toContain("Usage: arra-cli menu <subcommand>");
    expect(menu).toContain("arra-cli menu list --json");
    expect(plugins).toContain("Usage: arra-cli plugins <subcommand>");
    expect(plugins).toContain("enable <name>");
    expect(doctor).toContain("Usage: arra-cli doctor [--json]");
    expect(doctor).toContain("arra-cli doctor --json");
    expect(config).toContain("Usage: arra-cli config [show|path|use <name>]");
    expect(config).toContain("arra-cli config use cafe");
    expect(menuAdd).toContain("Usage: arra-cli menu add --path /p --label L");
    expect(menuAdd).toContain("arra-cli menu add --path /lab --label Lab");
    expect(sessionShow).toContain("Usage: arra-cli session show <id>");
    expect(sessionShow).toContain("arra-cli session show abc123");
    expect(pluginInstall).toContain("Usage: arra-cli plugin install <url-or-path>");
    expect(pluginInstall).toContain("arra-cli plugin install ./my-plugin --dry-run");
  }, 15_000);

  test("plugin commands expose manifest help and flags", async () => {
    const stdout = await cliHelp(["search", "--help"]);

    expect(stdout).toContain("search —");
    expect(stdout).toContain("Usage: arra-cli search");
    expect(stdout).toContain("--limit");
    expect(stdout).toContain("Examples:");
    expect(stdout).toContain("arra-cli search");
  }, 15_000);
});
