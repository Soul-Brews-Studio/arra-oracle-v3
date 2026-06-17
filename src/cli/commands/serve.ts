import { configure, forceKillProcess, isProcessAlive, readPidFile, removePidFile, waitForProcessesExit } from '../../process-manager/index.ts';
import { ORACLE_DATA_DIR } from '../../config.ts';

type StopReason =
  | 'not_running'
  | 'already_stopped'
  | 'stale_pid'
  | 'killed'
  | 'force_killed'
  | 'kill_failed'
  | 'timeout';

interface StopResult {
  stopped: boolean;
  reason?: StopReason;
  pid?: number;
}

export async function serveCommand(args: string[]): Promise<number> {
  if (!args[0] || args[0] !== 'serve' || args.includes('--help') || args.includes('-h')) {
    printUsage();
    return args[0] === 'serve' ? 0 : 1;
  }

  const sub = args[1]?.toLowerCase();
  const rest = args.slice(2);

  if (!sub || sub === 'start' || sub === 'foreground' || sub === 'background' || sub === 'daemon' || sub === 'bg') {
    return runServerStart(sub, args.slice(sub ? 2 : 1));
  }

  if (sub === 'status') {
    return runServerStatus(rest);
  }

  if (sub === 'stop') {
    return runServerStop();
  }

  console.error(`unknown serve subcommand: ${sub}`);
  printUsage();
  return 1;
}

async function runServerStart(mode: string | undefined, flags: string[]): Promise<number> {
  const flagSet = new Set(flags);
  const foreground = mode === 'foreground' || flagSet.has('--foreground') || flagSet.has('-f');
  const background =
    mode === 'background' ||
    mode === 'daemon' ||
    mode === 'bg' ||
    flagSet.has('--background') ||
    flagSet.has('-b');

  if (foreground && background) {
    console.error('Cannot use --foreground and --background together');
    return 1;
  }

  if (foreground && !background) {
    return runServerForeground();
  }

  return runServerBackground();
}

async function runServerBackground(): Promise<number> {
  const { ensureServerRunning, getServerStatus } = await import('../../ensure-server.ts');
  const ok = await ensureServerRunning({ verbose: false, timeout: 15000 });
  if (!ok) {
    console.error('failed to start server');
    return 1;
  }

  const status = await getServerStatus();
  if (status.running) {
    console.log(`Oracle server running on ${status.url} (pid=${status.pid ?? 'unknown'}, healthy=${status.healthy})`);
    return 0;
  }

  console.log(`Oracle server start requested; check status at ${status.url}`);
  return 1;
}

async function runServerForeground(): Promise<number> {
  const { startServer } = await import('../../server.ts');
  const server = await startServer();

  console.log(`🔮 Oracle server running in foreground on http://localhost:${server.port}`);

  return await new Promise<number>((resolve) => {
    const handle = () => {
      server.stop();
      resolve(0);
    };
    process.once('SIGINT', handle);
    process.once('SIGTERM', handle);
  });
}

async function runServerStatus(args: string[]): Promise<number> {
  const withJson = args.includes('--json');
  const { getServerStatus } = await import('../../ensure-server.ts');
  const status = await getServerStatus();

  if (withJson) {
    console.log(JSON.stringify(status, null, 2));
    return status.running && status.healthy ? 0 : 1;
  }

  if (!status.running) {
    console.log(`Oracle server not running on ${status.url}`);
    return 1;
  }

  const health = status.healthy ? 'healthy' : 'not healthy';
  console.log(`Oracle server running on ${status.url} (pid=${status.pid ?? 'unknown'}, ${health})`);
  return status.healthy ? 0 : 1;
}

async function runServerStop(): Promise<number> {
  configure({ dataDir: ORACLE_DATA_DIR, pidFileName: 'oracle-http.pid' });

  const pidInfo = readPidFile();
  if (!pidInfo?.pid) {
    console.log('Oracle server not running');
    return 0;
  }

  const result = await stopByPid(pidInfo.pid);
  console.log(formatStopResult(result));

  return result.stopped || result.reason === 'not_running' || result.reason === 'already_stopped' || result.reason === 'stale_pid'
    ? 0
    : 1;
}

function formatStopResult(result: StopResult): string {
  if (result.stopped) {
    return `Stopped server (pid=${result.pid ?? 'unknown'}, reason=${result.reason})`;
  }

  if (result.reason === 'not_running' || result.reason === 'already_stopped') {
    return 'Oracle server not running';
  }

  if (result.reason === 'stale_pid') {
    return `Removed stale PID file (pid=${result.pid ?? 'unknown'})`;
  }

  if (result.reason === 'kill_failed') {
    return `Failed to signal server (pid=${result.pid ?? 'unknown'})`;
  }

  if (result.reason === 'timeout') {
    return `Timed out waiting for server to stop (pid=${result.pid ?? 'unknown'})`;
  }

  return `Unable to stop server (pid=${result.pid ?? 'unknown'}, reason=${result.reason})`;
}

async function stopByPid(pid: number): Promise<StopResult> {
  if (!Number.isInteger(pid) || pid <= 0) {
    removePidFile();
    return { stopped: false, reason: 'stale_pid', pid };
  }

  if (!isProcessAlive(pid)) {
    removePidFile();
    return { stopped: false, reason: 'already_stopped', pid };
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    removePidFile();
    return { stopped: false, reason: 'kill_failed', pid };
  }

  const exited = await waitForProcessesExit([pid], 5000);
  if (exited) {
    removePidFile();
    return { stopped: true, reason: 'killed', pid };
  }

  await forceKillProcess(pid);
  const forceExited = await waitForProcessesExit([pid], 2000);
  if (!forceExited) {
    return { stopped: false, reason: 'timeout', pid };
  }

  removePidFile();
  return { stopped: true, reason: 'force_killed', pid };
}

function printUsage(): void {
  console.log('Usage: bun run src/cli/index.ts serve <start|stop|status> [--foreground|--background] [--json]');
  console.log('');
  console.log('Commands:');
  console.log('  start [--foreground|--background]   Start server (background default)');
  console.log('  status [--json]                      Show running status');
  console.log('  stop                                 Stop running server');
}
