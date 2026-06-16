import { writeFile } from "fs/promises";
import { isAbsolute, resolve } from "path";

export const CHANGE_TYPES = ["feat", "fix", "docs", "test", "chore"] as const;

export type ChangeType = typeof CHANGE_TYPES[number];

export interface ChangelogOptions {
  cwd?: string;
  outFile?: string;
  since?: string;
  stdout?: boolean;
}

export interface ChangelogCommit {
  hash: string;
  subject: string;
  type: ChangeType;
  text: string;
}

const TYPE_LABELS: Record<ChangeType, string> = {
  feat: "Features",
  fix: "Fixes",
  docs: "Documentation",
  test: "Tests",
  chore: "Chores",
};

function printHelp(): void {
  console.log("arra-cli changelog [--since <tag>] [--out CHANGELOG.md] [--stdout]\n");
  console.log("Generates CHANGELOG.md entries from git log since the last tag.");
  console.log("\nFlags:");
  console.log("  --since <tag>       start after this tag instead of the latest tag");
  console.log("  --out <file>        write to a custom file (default: CHANGELOG.md)");
  console.log("  --stdout            print changelog content instead of writing a file");
  console.log("  --help, -h          show this help");
}

function readValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index >= 0) return args[index + 1];
  const prefix = `${flag}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

export function parseChangelogOptions(args: string[]): ChangelogOptions {
  const since = readValue(args, "--since");
  const outFile = readValue(args, "--out");
  return {
    ...(since ? { since } : {}),
    ...(outFile ? { outFile } : {}),
    stdout: args.includes("--stdout"),
  };
}

async function git(args: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  if (code !== 0) throw new Error(stderr.trim() || `git ${args.join(" ")} failed`);
  return stdout.trim();
}

async function latestTag(cwd: string): Promise<string | undefined> {
  try {
    return (await git(["describe", "--tags", "--abbrev=0"], cwd)) || undefined;
  } catch {
    return undefined;
  }
}

export function classifySubject(subject: string): Pick<ChangelogCommit, "type" | "text"> {
  const match = /^(feat|fix|docs|test|chore)(?:\([^)]+\))?!?:\s+(.+)$/i.exec(subject);
  if (!match) return { type: "chore", text: subject };
  return { type: match[1].toLowerCase() as ChangeType, text: match[2] };
}

function parseLog(output: string): ChangelogCommit[] {
  return output
    .split("\x1e")
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash, subject = ""] = record.split("\x1f");
      return { hash, subject, ...classifySubject(subject) };
    });
}

export async function readCommitsSinceTag(options: ChangelogOptions = {}): Promise<{
  commits: ChangelogCommit[];
  since?: string;
}> {
  const cwd = options.cwd ?? process.cwd();
  const since = options.since ?? await latestTag(cwd);
  const range = since ? `${since}..HEAD` : "HEAD";
  try {
    const output = await git(["log", range, "--pretty=format:%H%x1f%s%x1e"], cwd);
    return { commits: parseLog(output), ...(since ? { since } : {}) };
  } catch (err) {
    if (String(err).includes("does not have any commits")) return { commits: [], ...(since ? { since } : {}) };
    throw err;
  }
}

export function renderChangelog(commits: ChangelogCommit[], since?: string): string {
  const lines = ["# Changelog", "", "## Unreleased", ""];
  lines.push(since ? `Changes since \`${since}\`.` : "Changes from the full git history.");
  lines.push("");
  const byType = new Map<ChangeType, ChangelogCommit[]>();
  for (const type of CHANGE_TYPES) byType.set(type, []);
  for (const commit of commits) byType.get(commit.type)?.push(commit);

  let wroteEntry = false;
  for (const type of CHANGE_TYPES) {
    const entries = byType.get(type) ?? [];
    if (!entries.length) continue;
    wroteEntry = true;
    lines.push(`### ${TYPE_LABELS[type]}`);
    for (const entry of entries) lines.push(`- ${entry.text} (${entry.hash.slice(0, 7)})`);
    lines.push("");
  }
  if (!wroteEntry) lines.push("No matching changes.", "");
  return lines.join("\n");
}

export async function generateChangelog(options: ChangelogOptions = {}): Promise<string> {
  const { commits, since } = await readCommitsSinceTag(options);
  return renderChangelog(commits, since);
}

function outputPath(cwd: string, outFile?: string): string {
  const file = outFile ?? "CHANGELOG.md";
  return isAbsolute(file) ? file : resolve(cwd, file);
}

export async function changelogCommand(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return 0;
  }

  try {
    const options = parseChangelogOptions(args);
    const cwd = options.cwd ?? process.cwd();
    const content = await generateChangelog({ ...options, cwd });
    if (options.stdout) process.stdout.write(content);
    else {
      const file = outputPath(cwd, options.outFile);
      await writeFile(file, content, "utf8");
      process.stdout.write(`wrote ${file}\n`);
    }
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}
