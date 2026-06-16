import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import { logger } from './logger.ts';

const execFileAsync = promisify(execFile);

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function getChildProcesses(parentPid: number): Promise<number[]> {
  if (process.platform !== 'win32') return [];
  if (!isPositiveInteger(parentPid)) {
    logger.warn('SYSTEM', 'Invalid parent PID for child process enumeration', { parentPid });
    return [];
  }

  try {
    const { stdout } = await execFileAsync(
      'wmic',
      ['process', 'where', `parentprocessid=${parentPid}`, 'get', 'processid', '/format:list'],
      { timeout: 60000 },
    );
    return processIdsFromWmic(stdout);
  } catch (error) {
    logger.warn('SYSTEM', 'Failed to enumerate child processes', { parentPid }, error as Error);
    return [];
  }
}

export async function forceKillProcess(pid: number): Promise<void> {
  if (!isPositiveInteger(pid)) {
    logger.warn('SYSTEM', 'Invalid PID for force kill', { pid });
    return;
  }

  try {
    if (process.platform === 'win32') {
      await execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F'], { timeout: 60000 });
    } else {
      process.kill(pid, 'SIGKILL');
    }
    logger.info('SYSTEM', 'Killed process', { pid });
  } catch (error) {
    logger.debug('SYSTEM', 'Process already exited during force kill', { pid }, error as Error);
  }
}

export async function waitForProcessesExit(pids: number[], timeoutMs: number): Promise<boolean> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const stillAlive = pids.filter(pid => isProcessAlive(pid));
    if (stillAlive.length === 0) {
      logger.info('SYSTEM', 'All processes exited');
      return true;
    }

    logger.debug('SYSTEM', 'Waiting for processes to exit', { stillAlive });
    await new Promise(r => setTimeout(r, 100));
  }

  logger.warn('SYSTEM', 'Timeout waiting for processes to exit');
  return false;
}

export async function findProcesses(pattern: string): Promise<number[]> {
  const search = normalizeProcessPattern(pattern);
  if (!search) return [];

  try {
    if (process.platform === 'win32') return await findWindowsProcesses(search);
    return await findUnixProcesses(search);
  } catch (error) {
    logger.warn('SYSTEM', 'Failed to find processes', { pattern: search }, error as Error);
    return [];
  }
}

export async function killProcesses(pattern: string): Promise<number> {
  const search = normalizeProcessPattern(pattern);
  if (!search) return 0;

  const pids = await findProcesses(search);
  if (pids.length === 0) return 0;

  logger.info('SYSTEM', 'Killing processes', { pattern: search, count: pids.length, pids });
  let killed = 0;
  for (const pid of pids) {
    try {
      if (process.platform === 'win32') {
        execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { timeout: 60000, stdio: 'ignore' });
      } else {
        process.kill(pid, 'SIGKILL');
      }
      killed++;
    } catch {
      logger.debug('SYSTEM', 'Process may have already exited', { pid });
    }
  }
  return killed;
}

async function findWindowsProcesses(pattern: string): Promise<number[]> {
  const query = `commandline like '%${pattern.replaceAll("'", "''")}%'`;
  const { stdout } = await execFileAsync(
    'wmic',
    ['process', 'where', query, 'get', 'processid', '/format:list'],
    { timeout: 60000 },
  );
  return processIdsFromWmic(stdout);
}

async function findUnixProcesses(pattern: string): Promise<number[]> {
  const { stdout } = await execFileAsync('ps', ['aux'], { timeout: 60000 });
  return stdout
    .split('\n')
    .filter(line => line.includes(pattern))
    .map(line => Number.parseInt(line.trim().split(/\s+/)[1] ?? '', 10))
    .filter(isPositiveInteger);
}

function processIdsFromWmic(stdout: string): number[] {
  return stdout
    .trim()
    .split('\n')
    .map(line => Number.parseInt(line.match(/ProcessId=(\d+)/i)?.[1] ?? '', 10))
    .filter(isPositiveInteger);
}

function normalizeProcessPattern(pattern: string): string | null {
  if (typeof pattern !== 'string') return null;
  const trimmed = pattern.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}
