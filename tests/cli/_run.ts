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
const DEFAULT_CLI_TIMEOUT_MS = 20_000;
const KILL_GRACE_MS = 250;

function safeKillTree(pid: number | undefined, signal: NodeJS.Signals): void {
  if (!pid || process.platform === "win32") return;
  try {
    process.kill(-pid, signal);
  } catch {
    // ignore: fallback to direct child kill only
  }
}

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

export async function runCli(
  args: string[],
  env: Record<string, string> = {},
  options: { cwd?: string; timeoutMs?: number } = {},
): Promise<RunResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_CLI_TIMEOUT_MS;
  const proc = Bun.spawn(["bun", "run", CLI_ENTRY, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    cwd: options.cwd,
    env: { ...process.env, ...env },
  });

  const stdoutPromise = new Response(proc.stdout).text();
  const stderrPromise = new Response(proc.stderr).text();
  const exitPromise = proc.exited;
  const timeoutError = new Error(`runCli timed out after ${timeoutMs}ms`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(timeoutError), timeoutMs);
  });
  const collectResult = Promise.all([stdoutPromise, stderrPromise, exitPromise]).then(([
    stdout,
    stderr,
    code,
  ]) => ({ stdout, stderr, code }));

  try {
    return await Promise.race([collectResult, timeoutPromise]);
  } catch (error) {
    if (error === timeoutError) {
      safeKillTree(proc.pid, "SIGTERM");
      proc.kill("SIGTERM");
      await Promise.race([proc.exited, new Promise<void>((resolve) => setTimeout(resolve, KILL_GRACE_MS))]).catch(() => undefined);
      safeKillTree(proc.pid, "SIGKILL");
      proc.kill("SIGKILL");
      const [stdout, stderr] = await Promise.allSettled([stdoutPromise, stderrPromise]);
      return {
        stdout: stdout.status === "fulfilled" ? stdout.value : "",
        stderr: `${stderr.status === "fulfilled" ? stderr.value : ""} [runCli timeout after ${timeoutMs}ms]`,
        code: 143,
      };
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    safeKillTree(proc.pid, "SIGTERM");
    proc.kill();
    await proc.exited.catch(() => undefined);
  }
}

export function tryParseJson(s: string): unknown | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
