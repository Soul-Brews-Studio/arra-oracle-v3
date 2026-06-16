import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type Parsed = { pos: string[]; flags: Record<string, string | boolean> };
export type InvokeResult = { ok: boolean; output?: string; error?: string };
export type RunOptions = { cwd?: string; env?: Record<string, string | undefined>; inherit?: boolean; capture?: boolean };
export type RunResult = { code: number | null; stdout?: string; stderr?: string };
export type Runner = (cmd: string, args: string[], options?: RunOptions) => Promise<RunResult>;
export type ServeDeps = {
  fetch?: typeof fetch;
  isAlive?: (pid: number) => boolean;
  kill?: (pid: number, signal?: NodeJS.Signals) => void;
  sleep?: (ms: number) => Promise<void>;
  start?: (cwd: string, env: Record<string, string | undefined>) => number | undefined;
};

const DEFAULT_PORT = '47778';
const PID_FILE_NAME = 'server.pid';
type ServeState = { pid: number; port?: string; root?: string; startedAt?: string };
const REPO_SLUGS = ['Soul-Brews-Studio/arra-oracle-v3', 'github.com/Soul-Brews-Studio/arra-oracle-v3'];

function flag(parsed: Parsed, name: string): string | undefined {
  const value = parsed.flags[name.replace(/-/g, '_')];
  return value === undefined || value === false ? undefined : value === true ? 'true' : String(value);
}

function serveAction(parsed: Parsed): 'start' | 'stop' | 'status' {
  const action = parsed.pos[0]?.toLowerCase();
  if (flag(parsed, 'status') || action === 'status') return 'status';
  if (flag(parsed, 'stop') || action === 'stop') return 'stop';
  if (!action || action === 'start') return 'start';
  throw new Error('serve action must be start, stop, or status');
}

function parsePort(parsed: Parsed, env: Record<string, string | undefined>): string {
  const port = flag(parsed, 'port') || env.ORACLE_PORT || env.PORT || DEFAULT_PORT;
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error('--port must be a number from 1 to 65535');
  }
  return port;
}

function pidFile(env: Record<string, string | undefined>): string {
  const home = env.HOME || env.USERPROFILE || homedir();
  return join(home, '.arra-oracle-v2', PID_FILE_NAME);
}

function validPid(pid: number): number | undefined {
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

function readState(path: string): ServeState | undefined {
  if (!existsSync(path)) return undefined;
  const text = readFileSync(path, 'utf8').trim();
  const legacyPid = validPid(Number(text));
  if (legacyPid) return { pid: legacyPid };
  try {
    const parsed = JSON.parse(text) as Partial<ServeState>;
    const pid = validPid(Number(parsed.pid));
    return pid ? { ...parsed, pid, port: parsed.port ? String(parsed.port) : undefined } : undefined;
  } catch {
    return undefined;
  }
}

function writeState(path: string, state: ServeState): void {
  writeFileSync(path, `${JSON.stringify(state)}\n`);
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error: any) { return error?.code === 'EPERM'; }
}

async function resolveRoot(env: Record<string, string | undefined>, runner: Runner): Promise<string> {
  const explicit = env.ORACLE_ROOT?.trim();
  if (explicit) return explicit;
  for (const slug of REPO_SLUGS) {
    const result = await runner('ghq', ['locate', slug], { capture: true });
    if (result.code === 0 && result.stdout?.trim()) return result.stdout.trim();
  }
  throw new Error('ORACLE_ROOT is not set and ghq locate could not find Soul-Brews-Studio/arra-oracle-v3');
}

function startServer(cwd: string, env: Record<string, string | undefined>): number | undefined {
  const child = spawn('bun', ['run', 'server'], { cwd, env: { ...process.env, ...env }, detached: true, stdio: 'ignore' });
  child.unref();
  return child.pid;
}

async function health(port: string, fetcher: typeof fetch): Promise<string> {
  const url = `http://127.0.0.1:${port}/api/health`;
  try {
    const res = await fetcher(url, { signal: AbortSignal.timeout(2000) });
    const text = await res.text();
    return `${res.ok ? 'ok' : 'bad'} ${res.status}${text ? ` ${text.slice(0, 120)}` : ''}`;
  } catch (error) {
    return `down ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function stopPid(pid: number, deps: Required<Pick<ServeDeps, 'isAlive' | 'kill' | 'sleep'>>): Promise<boolean> {
  if (!deps.isAlive(pid)) return true;
  deps.kill(pid, 'SIGTERM');
  for (let i = 0; i < 10; i++) {
    await deps.sleep(150);
    if (!deps.isAlive(pid)) return true;
  }
  deps.kill(pid, 'SIGKILL');
  await deps.sleep(100);
  return !deps.isAlive(pid);
}

export async function runServe(parsed: Parsed, runner: Runner, env: Record<string, string | undefined>, deps: ServeDeps = {}): Promise<InvokeResult> {
  try {
    const port = parsePort(parsed, env);
    const path = pidFile(env);
    const state = readState(path);
    const currentPid = state?.pid;
    const isAlive = deps.isAlive ?? alive;
    const kill = deps.kill ?? ((pid, signal) => process.kill(pid, signal));
    const sleep = deps.sleep ?? ((ms) => new Promise<void>(resolve => setTimeout(resolve, ms)));

    const action = serveAction(parsed);

    if (action === 'status') {
      const healthPort = flag(parsed, 'port') ? port : state?.port ?? port;
      const pidState = currentPid ? `${isAlive(currentPid) ? 'alive' : 'dead'} pid=${currentPid}` : 'missing pid';
      const details = [state?.root && `root: ${state.root}`, `port: ${healthPort}`].filter(Boolean).join('\n');
      return { ok: true, output: `arra serve: ${pidState}${details ? `\n${details}` : ''}\nhealth: ${await health(healthPort, deps.fetch ?? fetch)}` };
    }

    if (action === 'stop') {
      if (!currentPid) return { ok: true, output: `arra serve: stopped (no ${path})` };
      const stopped = await stopPid(currentPid, { isAlive, kill, sleep });
      if (stopped && existsSync(path)) unlinkSync(path);
      return stopped ? { ok: true, output: `arra serve: stopped pid=${currentPid}` } : { ok: false, error: `failed to stop pid=${currentPid}` };
    }

    if (currentPid && isAlive(currentPid)) {
      const healthPort = flag(parsed, 'port') ? port : state?.port ?? port;
      return { ok: true, output: `arra serve: already running pid=${currentPid}\nport: ${healthPort}\nhealth: ${await health(healthPort, deps.fetch ?? fetch)}` };
    }

    const cwd = await resolveRoot(env, runner);
    mkdirSync(dirname(path), { recursive: true });
    const pid = (deps.start ?? startServer)(cwd, { ...env, ORACLE_PORT: port });
    if (!pid) throw new Error('bun run server did not return a PID');
    writeState(path, { pid, port, root: cwd, startedAt: new Date().toISOString() });
    return { ok: true, output: `arra serve: started pid=${pid} port=${port}\nroot: ${cwd}\npid: ${path}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
