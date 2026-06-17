import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { basename, join } from 'path';
import {
  configure,
  getDataDir,
  getLogger,
  getPidFilePath,
  readPidFile,
  setLogger,
  type Logger,
} from '../../src/process-manager/index.ts';

const previousPid = { dataDir: getDataDir(), pidFileName: basename(getPidFilePath()) };
const originalLogger = getLogger();
const tempDirs: string[] = [];

afterEach(() => {
  setLogger(originalLogger);
  configure(previousPid);
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test('custom logger receives warnings from process-manager internals', () => {
  const events: string[] = [];
  setLogger(capturingLogger(events));
  const dir = mkdtemp();
  configure({ dataDir: dir, pidFileName: 'worker.pid' });
  mkdirSync(dir, { recursive: true });
  writeFileSync(getPidFilePath(), '{ invalid json');

  expect(readPidFile()).toBeNull();
  expect(events).toContain('warn:SYSTEM:Failed to parse PID file');
});

function capturingLogger(events: string[]): Logger {
  const push = (level: string, category: string, message: string) => {
    events.push(`${level}:${category}:${message}`);
  };
  return {
    debug: (category, message) => push('debug', category, message),
    info: (category, message) => push('info', category, message),
    warn: (category, message) => push('warn', category, message),
    error: (category, message) => push('error', category, message),
    success: (category, message) => push('success', category, message),
  };
}

function mkdtemp(): string {
  const dir = join(tmpdir(), `arra-logger-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  tempDirs.push(dir);
  return dir;
}
