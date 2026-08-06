import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
import { logger } from './logger.ts';

let dataDir = path.join(homedir(), '.bun-process-manager');
let pidFileName = 'worker.pid';

export interface PidInfo {
  pid: number;
  port: number;
  startedAt: string;
  [key: string]: unknown;
}

export function configure(options: { dataDir?: string; pidFileName?: string }): void {
  if (options.dataDir) dataDir = options.dataDir;
  if (options.pidFileName) pidFileName = options.pidFileName;
}

export function getDataDir(): string {
  return dataDir;
}

export function getPidFilePath(): string {
  return path.join(dataDir, pidFileName);
}

export function writePidFile(info: PidInfo): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(getPidFilePath(), JSON.stringify(info, null, 2));
}

export function readPidFile(): PidInfo | null {
  const pidFile = getPidFilePath();
  if (!existsSync(pidFile)) return null;

  try {
    const parsed = JSON.parse(readFileSync(pidFile, 'utf-8')) as unknown;
    if (!isPidInfo(parsed)) {
      logger.warn('SYSTEM', 'Invalid PID file payload', { path: pidFile });
      return null;
    }
    return parsed;
  } catch (error) {
    logger.warn('SYSTEM', 'Failed to parse PID file', { path: pidFile }, error as Error);
    return null;
  }
}

export function removePidFile(): void {
  const pidFile = getPidFilePath();
  if (!existsSync(pidFile)) return;

  try {
    unlinkSync(pidFile);
  } catch (error) {
    logger.warn('SYSTEM', 'Failed to remove PID file', { path: pidFile }, error as Error);
  }
}

function isPidInfo(value: unknown): value is PidInfo {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Number.isInteger(record.pid) &&
    Number(record.pid) > 0 &&
    Number.isInteger(record.port) &&
    Number(record.port) >= 0 &&
    typeof record.startedAt === 'string' &&
    record.startedAt.trim().length > 0;
}
