import { readFile, writeFile } from "fs/promises";
import { fileURLToPath } from "url";
import { isAbsolute, resolve } from "path";
import { generateChangelog } from "./changelog.ts";

type ReleaseChannel = "alpha" | "beta" | "stable";

export interface ReleaseOptions {
  cwd?: string;
  channel: ReleaseChannel;
  changelogFile: string;
  dryRun: boolean;
}

export interface ReleaseResult {
  version: string;
  tag: string;
  changelogPath?: string;
  dryRun: boolean;
}

const CALVER_SCRIPT = fileURLToPath(new URL("../../../scripts/calver.ts", import.meta.url));

function printHelp(): void {
  console.log("arra-cli release [--beta|--stable] [--changelog CHANGELOG.md] [--dry-run]\n");
  console.log("Bumps package.json with scripts/calver.ts, writes a changelog, and creates a git tag.");
  console.log("\nFlags:");
  console.log("  --beta              cut a beta CalVer instead of alpha");
  console.log("  --stable            cut stable CalVer without a prerelease suffix");
  console.log("  --changelog <file>  changelog output path (default: CHANGELOG.md)");
  console.log("  --dry-run, --check  print the target version without writing files or tags");
  console.log("  --help, -h          show this help");
}

function readValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index >= 0) return args[index + 1];
  const prefix = `${flag}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

export function parseReleaseOptions(args: string[]): ReleaseOptions {
  const stable = args.includes("--stable");
  const beta = args.includes("--beta");
  if (stable && beta) throw new Error("--stable and --beta are mutually exclusive");
  return {
    channel: stable ? "stable" : beta ? "beta" : "alpha",
    changelogFile: readValue(args, "--changelog") ?? "CHANGELOG.md",
    dryRun: args.includes("--dry-run") || args.includes("--check"),
  };
}

async function run(command: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  if (code !== 0) throw new Error((stderr || stdout).trim() || `${command.join(" ")} failed`);
  return stdout.trim();
}

function calverArgs(options: ReleaseOptions): string[] {
  const args: string[] = [];
  if (options.channel === "beta") args.push("--beta");
  if (options.channel === "stable") args.push("--stable");
  if (options.dryRun) args.push("--check");
  return args;
}

function parseTarget(output: string): string {
  const match = output.match(/Target:\s+v([^\s]+)/);
  if (!match) throw new Error("calver did not print a target version");
  return match[1];
}

async function readPackageVersion(cwd: string): Promise<string> {
  const pkg = JSON.parse(await readFile(resolve(cwd, "package.json"), "utf8")) as { version?: unknown };
  if (typeof pkg.version !== "string") throw new Error("package.json version must be a string");
  return pkg.version;
}

function outputPath(cwd: string, file: string): string {
  return isAbsolute(file) ? file : resolve(cwd, file);
}

async function createTag(cwd: string, tag: string): Promise<void> {
  await run(["git", "tag", tag], cwd);
}

export async function runRelease(options: ReleaseOptions): Promise<ReleaseResult> {
  const cwd = options.cwd ?? process.cwd();
  const calverOutput = await run(["bun", CALVER_SCRIPT, ...calverArgs(options)], cwd);
  const version = options.dryRun ? parseTarget(calverOutput) : await readPackageVersion(cwd);
  const tag = `v${version}`;

  if (options.dryRun) return { version, tag, dryRun: true };

  const changelogPath = outputPath(cwd, options.changelogFile);
  await writeFile(changelogPath, await generateChangelog({ cwd }), "utf8");
  await createTag(cwd, tag);
  return { version, tag, changelogPath, dryRun: false };
}

export async function releaseCommand(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return 0;
  }

  try {
    const result = await runRelease({ ...parseReleaseOptions(args), cwd: process.cwd() });
    process.stdout.write(`target ${result.tag}\n`);
    if (result.dryRun) process.stdout.write("dry run: no files or tags written\n");
    else process.stdout.write(`wrote ${result.changelogPath}\ncreated ${result.tag}\n`);
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}
