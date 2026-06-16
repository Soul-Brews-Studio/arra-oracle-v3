import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  changelogCommand,
  generateChangelog,
  parseChangelogOptions,
} from "../../../src/cli/commands/changelog.ts";
import { runCli } from "../_run.ts";

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "ARRA Test",
  GIT_AUTHOR_EMAIL: "arra-test@example.com",
  GIT_COMMITTER_NAME: "ARRA Test",
  GIT_COMMITTER_EMAIL: "arra-test@example.com",
};

async function git(cwd: string, args: string[]): Promise<void> {
  const proc = Bun.spawn(["git", ...args], { cwd, env: gitEnv, stdout: "pipe", stderr: "pipe" });
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  if (code !== 0) throw new Error(stderr);
}

async function emptyCommit(cwd: string, message: string): Promise<void> {
  await git(cwd, ["commit", "--allow-empty", "-m", message]);
}

async function initRepo(cwd: string): Promise<void> {
  await git(cwd, ["init"]);
  await git(cwd, ["config", "user.name", "ARRA Test"]);
  await git(cwd, ["config", "user.email", "arra-test@example.com"]);
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

async function inCwd<T>(cwd: string, action: () => Promise<T>): Promise<T> {
  const previous = process.cwd();
  process.chdir(cwd);
  try {
    return await action();
  } finally {
    process.chdir(previous);
  }
}

describe("changelog generator", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "arra-changelog-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("groups conventional commits since the latest tag", async () => {
    await initRepo(root);
    await emptyCommit(root, "chore: baseline");
    await git(root, ["tag", "v1.0.0"]);
    await emptyCommit(root, "feat(api): add search");
    await emptyCommit(root, "fix: repair menu");
    await emptyCommit(root, "docs: update plugin guide");
    await emptyCommit(root, "test: cover changelog");
    await emptyCommit(root, "chore: tidy scripts");
    await emptyCommit(root, "refactor: simplify internals");

    const output = await generateChangelog({ cwd: root });

    expect(output).toContain("Changes since `v1.0.0`.");
    expect(output).toContain("### Features\n- add search (");
    expect(output).toContain("### Fixes\n- repair menu (");
    expect(output).toContain("### Documentation\n- update plugin guide (");
    expect(output).toContain("### Tests\n- cover changelog (");
    expect(output).toContain("### Chores");
    expect(output).toContain("- tidy scripts (");
    expect(output).toContain("- refactor: simplify internals (");
    expect(output).not.toContain("baseline");
  });

  test("uses full history when no tag exists", async () => {
    await initRepo(root);
    await emptyCommit(root, "feat: first release note");

    const output = await generateChangelog({ cwd: root });

    expect(output).toContain("Changes from the full git history.");
    expect(output).toContain("- first release note (");
  });

  test("parses spaced and equals-form flags", () => {
    expect(parseChangelogOptions(["--since", "v1.0.0", "--out=notes.md", "--stdout"])).toEqual({
      since: "v1.0.0",
      outFile: "notes.md",
      stdout: true,
    });
  });

  test("rejects malformed changelog flags before running git", () => {
    expect(() => parseChangelogOptions(["--since"])).toThrow("missing value for --since");
    expect(() => parseChangelogOptions(["--out="])).toThrow("missing value for --out");
    expect(() => parseChangelogOptions(["--stdout=true"])).toThrow("unknown changelog option: --stdout=true");
    expect(() => parseChangelogOptions(["--unknown"])).toThrow("unknown changelog option: --unknown");
  });

  test("writes CHANGELOG.md through the command", async () => {
    await initRepo(root);
    await emptyCommit(root, "chore: baseline");
    await git(root, ["tag", "v1.0.0"]);
    await emptyCommit(root, "fix: write release notes");

    const result = await inCwd(root, () => captureOutput(() => changelogCommand([])));
    const path = join(root, "CHANGELOG.md");

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("wrote ");
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toContain("- write release notes (");
  });

  test("prints changelog content to stdout", async () => {
    await initRepo(root);
    await emptyCommit(root, "feat: stdout release note");

    const result = await inCwd(root, () => captureOutput(() => changelogCommand(["--stdout"])));

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("# Changelog");
    expect(result.stdout).toContain("- stdout release note (");
  });

  test("reports git failures as command errors", async () => {
    const result = await inCwd(root, () => captureOutput(() => changelogCommand(["--stdout"])));

    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/git|repository/i);
  });

  test("prints command help", async () => {
    const result = await captureOutput(() => changelogCommand(["--help"]));

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("arra-cli changelog");
    expect(result.stdout).toContain("--since <tag>");
  });

  test("is wired into the CLI dispatcher", async () => {
    await initRepo(root);
    await emptyCommit(root, "docs: cli dispatcher release note");

    const result = await runCli(["changelog", "--stdout"], {
      HOME: join(root, "home"),
      ORACLE_DATA_DIR: join(root, "data"),
    }, { cwd: root });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("- cli dispatcher release note (");
  }, 15_000);
});
