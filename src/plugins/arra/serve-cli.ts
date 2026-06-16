import { homedir } from 'node:os';
import { join } from 'node:path';
import { ORACLE_DATA_DIR_NAME, ORACLE_DEFAULT_PORT, PID_FILE_NAME } from '../../const.ts';
import { configure, isProcessAlive, readPidFile, removePidFile, waitForProcessesExit, writePidFile } from '../../process-manager/index.ts';

type CliResult = { ok: boolean; output?: string; error?: string };
type ServeAction = 'start' | 'stop' | 'status';

type ServeOptions = {
  action: ServeAction;
  port: number;
  json: boolean;
};

type ServeDeps = {
  spawn?: typeof Bun.spawn;
  fetch?: typeof fetch;
  cwd?: string;
};

const DEFAULT_HOST = '127.0.0.1';

export async function serveCli(args: string[], deps: ServeDeps = {}): Promise<CliResult> {
  const parsed = parseServeArgs(args);
  if ('error' in parsed) return { ok: false, error: parsed.error };
  configure({ dataDir: oracleDataDir(), pidFileName: PID_FILE_NAME });
  if (parsed.action === 'status') return renderStatus(parsed, deps);
  if (parsed.action === 'stop') return stopServer(parsed);
  return startServer(parsed, deps);
}

function parseServeArgs(args: string[]): ServeOptions | { error: string } {
  let action: ServeAction = 'start';
  let port = Number(process.env.ORACLE_PORT || process.env.PORT || ORACLE_DEFAULT_PORT);
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === 'start') action = 'start';
    else if (arg === 'status' || arg === '--status') action = 'status';
    else if (arg === 'stop' || arg === '--stop') action = 'stop';
    else if (arg === '--json') json = true;
    else if (arg === '--port') {
      const value = Number(args[++i]);
      if (!Number.isInteger(value) || value < 1 || value > 65_535) return { error: '--port must be an integer from 1 to 65535' };
      port = value;
    } else return { error: `unknown serve option: ${arg}` };
  }
  return { action, port, json };
}

async function renderStatus(options: ServeOptions, deps: ServeDeps): Promise<CliResult> {
  const status = await serverStatus(options.port, deps.fetch);
  if (options.json) return { ok: true, output: JSON.stringify(status, null, 2) };
  if (!status.running) return { ok: true, output: `Oracle server not running on ${status.url}` };
  const health = status.healthy ? 'healthy' : 'not healthy';
  return { ok: true, output: `Oracle server running on ${status.url} (pid=${status.pid ?? 'unknown'}, ${health})` };
}

async function startServer(options: ServeOptions, deps: ServeDeps): Promise<CliResult> {
  const status = await serverStatus(options.port, deps.fetch);
  if (status.running) return { ok: true, output: `Oracle server already running on ${status.url} (pid=${status.pid ?? 'unknown'})` };
  const child = (deps.spawn ?? Bun.spawn)(['bun', 'run', 'server'], {
    cwd: deps.cwd ?? process.env.ORACLE_REPO_ROOT ?? process.cwd(),
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    env: { ...process.env, PORT: String(options.port), ORACLE_PORT: String(options.port) },
  });
  if (!child.pid) return { ok: false, error: 'failed to spawn Oracle server' };
  child.unref?.();
  writePidFile({ pid: child.pid, port: options.port, startedAt: new Date().toISOString(), name: 'oracle-http' });
  return { ok: true, output: `Oracle server started on http://${DEFAULT_HOST}:${options.port} (pid=${child.pid})` };
}

async function stopServer(options: ServeOptions): Promise<CliResult> {
  const info = readPidFile();
  if (!info?.pid) return { ok: true, output: `Oracle server not running on http://${DEFAULT_HOST}:${options.port}` };
  if (!isProcessAlive(info.pid)) {
    removePidFile();
    return { ok: true, output: `Removed stale PID file (pid=${info.pid})` };
  }
  try { process.kill(info.pid, 'SIGTERM'); } catch (error) {
    return { ok: false, error: `Failed to stop server pid=${info.pid}: ${error instanceof Error ? error.message : String(error)}` };
  }
  const stopped = await waitForProcessesExit([info.pid], 5000);
  if (stopped) removePidFile();
  return stopped
    ? { ok: true, output: `Stopped Oracle server (pid=${info.pid})` }
    : { ok: false, error: `Timed out waiting for Oracle server to stop (pid=${info.pid})` };
}

async function serverStatus(port: number, fetcher: typeof fetch = fetch) {
  const info = readPidFile();
  const processAlive = info?.pid ? isProcessAlive(info.pid) : false;
  const healthy = await isHealthy(port, fetcher);
  return {
    running: processAlive || healthy,
    pid: info?.pid,
    port,
    healthy,
    url: `http://${DEFAULT_HOST}:${port}`,
  };
}

async function isHealthy(port: number, fetcher: typeof fetch): Promise<boolean> {
  try {
    const response = await fetcher(`http://${DEFAULT_HOST}:${port}/api/health`, { signal: AbortSignal.timeout(1200) });
    if (!response.ok) return false;
    const body = await response.json() as { status?: string };
    return body.status === 'ok';
  } catch { return false; }
}

function oracleDataDir(): string {
  return process.env.ORACLE_DATA_DIR || join(homedir(), ORACLE_DATA_DIR_NAME);
}
