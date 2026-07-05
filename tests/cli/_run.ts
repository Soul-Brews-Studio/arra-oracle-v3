/**
 * CLI subprocess helper — spawns arra-cli with isolated env and captures output.
 *
 * Defaults:
 *   - ORACLE_API: http://localhost:47778 (override with env)
 *   - HOME: caller-controlled (set per-test for plugin-list isolation)
 */
import { join } from "path";

const REPO_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const CLI_ENTRY = join(REPO_ROOT, "cli/src/cli.ts");

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

export async function runCli(
  args: string[],
  env: Record<string, string> = {},
  options: { cwd?: string } = {},
): Promise<RunResult> {
  const proc = Bun.spawn(["bun", "run", CLI_ENTRY, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    cwd: options.cwd,
    env: { ...process.env, ...env },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { stdout, stderr, code };
}

export function tryParseJson(s: string): unknown | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
