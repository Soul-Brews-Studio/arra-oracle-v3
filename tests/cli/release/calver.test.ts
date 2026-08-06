import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  parseReleaseOptions,
  releaseCommand,
  runRelease,
} from "../../../src/cli/commands/release.ts";
import { runCli } from "../_run.ts";

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "ARRA Test",
  GIT_AUTHOR_EMAIL: "arra-test@example.com",
  GIT_COMMITTER_NAME: "ARRA Test",
  GIT_COMMITTER_EMAIL: "arra-test@example.com",
};

async function git(cwd: string, args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...args], { cwd, env: gitEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  if (code !== 0) throw new Error(stderr);
  return stdout.trim();
}

function writePackage(root: string, version = "26.1.1-alpha.1"): void {
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "release-test", version }, null, 2) + "\n");
}

async function initRepo(root: string): Promise<void> {
  await git(root, ["init"]);
  await git(root, ["config", "user.name", "ARRA Test"]);
  await git(root, ["config", "user.email", "arra-test@example.com"]);
  writePackage(root);
  await git(root, ["add", "package.json"]);
  await git(root, ["commit", "-m", "chore: baseline"]);
  await git(root, ["tag", "v26.1.1-alpha.1"]);
}

async function emptyCommit(root: string, message: string): Promise<void> {
  await git(root, ["commit", "--allow-empty", "-m", message]);
}

async function inCwd<T>(cwd: string, action: () => Promise<T>): Promise<T> {
  const previous = process.cwd();
  process.chdir(cwd);
  try {
    return await action();
  } finally {
    process.chdir(previous);
  }
}

async function captureOutput(action: () => Promise<number>): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  const originalWrite = process.stdout.write;
  const originalLog = console.log;
  const originalError = console.error;
  let stdout = "";
  let stderr = "";
  (process.stdout as unknown as { write: (chunk: unknown) => boolean }).write = (chunk) => {
    stdout += String(chunk);
    return true;
  };
  console.log = (...parts: unknown[]) => {
    stdout += parts.join(" ") + "\n";
  };
  console.error = (...parts: unknown[]) => {
    stderr += parts.join(" ") + "\n";
  };
  try {
    const code = await action();
    return { code, stdout, stderr };
  } finally {
    process.stdout.write = originalWrite;
    console.log = originalLog;
    console.error = originalError;
  }
}

describe("release CalVer CLI", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "arra-release-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("bumps package.json, writes changelog, and creates a tag", async () => {
    await initRepo(root);
    await emptyCommit(root, "feat: release cli");
    await emptyCommit(root, "fix: release tag");

    const result = await inCwd(root, () => captureOutput(() => releaseCommand(["--changelog", "notes.md"])));
    const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;

    expect(result.code).toBe(0);
    expect(version).toMatch(/^\d+\.\d+\.\d+-alpha\.\d+$/);
    expect(result.stdout).toContain(`target v${version}`);
    expect(readFileSync(join(root, "notes.md"), "utf8")).toContain("- release cli (");
    expect(await git(root, ["tag", "--list", `v${version}`])).toBe(`v${version}`);
  }, 20_000);

  test("dry run reports stable target without writing files or tags", async () => {
    await initRepo(root);

    const result = await runRelease({ ...parseReleaseOptions(["--stable", "--dry-run"]), cwd: root });
    const packageVersion = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;

    expect(result.dryRun).toBe(true);
    expect(result.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(packageVersion).toBe("26.1.1-alpha.1");
    expect(existsSync(join(root, "CHANGELOG.md"))).toBe(false);
    expect(await git(root, ["tag", "--list", result.tag])).toBe("");
  }, 20_000);

  test("dry run supports beta CalVer targets", async () => {
    await initRepo(root);

    const result = await runRelease({ ...parseReleaseOptions(["--beta", "--dry-run"]), cwd: root });

    expect(result.dryRun).toBe(true);
    expect(result.version).toMatch(/^\d+\.\d+\.\d+-beta\.\d+$/);
    expect(result.tag).toBe(`v${result.version}`);
  }, 20_000);

  test("parses options and rejects conflicting channels", () => {
    expect(parseReleaseOptions(["--beta", "--changelog=beta.md", "--check"])).toEqual({
      channel: "beta",
      changelogFile: "beta.md",
      dryRun: true,
    });
    expect(() => parseReleaseOptions(["--stable", "--beta"])).toThrow("--stable and --beta");
  });

  test("prints command help", async () => {
    const result = await captureOutput(() => releaseCommand(["--help"]));

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("arra-cli release");
    expect(result.stdout).toContain("--stable");
  });

  test("reports calver failures", async () => {
    writePackage(root, "26.13.1-alpha.1");

    const result = await inCwd(root, () => captureOutput(() => releaseCommand([])));

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("ghost date");
  }, 20_000);

  test("is wired into the CLI dispatcher", async () => {
    await initRepo(root);

    const result = await runCli(["release", "--dry-run"], {
      HOME: join(root, "home"),
      ORACLE_DATA_DIR: join(root, "data"),
    }, { cwd: root });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("dry run: no files or tags written");
  }, 20_000);
});
