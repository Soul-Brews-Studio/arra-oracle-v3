import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { basename, join } from 'path';
import { configure, getDataDir, getPidFilePath, readPidFile } from '../../src/process-manager/index.ts';

const previous = { dataDir: getDataDir(), pidFileName: basename(getPidFilePath()) };
const tempDirs: string[] = [];

afterEach(() => {
  configure(previous);
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test('PID file reader rejects malformed JSON shapes', () => {
  const dir = mkdtemp();
  configure({ dataDir: dir, pidFileName: 'worker.pid' });
  mkdirSync(dir, { recursive: true });
  writeFileSync(getPidFilePath(), JSON.stringify({ pid: 'abc', port: 47778, startedAt: 'now' }));
  expect(readPidFile()).toBeNull();
});

function mkdtemp(): string {
  const dir = join(tmpdir(), `arra-pid-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  tempDirs.push(dir);
  return dir;
}
