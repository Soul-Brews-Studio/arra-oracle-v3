import { afterEach, expect, test } from 'bun:test';
import { rmSync } from 'fs';
import { tmpdir } from 'os';
import { basename, join } from 'path';
import { configure, getDataDir, getPidFilePath, readPidFile, writePidFile } from '../../src/process-manager/index.ts';

const previous = { dataDir: getDataDir(), pidFileName: basename(getPidFilePath()) };
const tempDirs: string[] = [];

afterEach(() => {
  configure(previous);
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test('PID file reader preserves valid metadata', () => {
  configure({ dataDir: mkdtemp(), pidFileName: 'worker.pid' });
  writePidFile({ pid: 123, port: 0, startedAt: '2026-06-16T00:00:00.000Z', name: 'oracle-http' });
  expect(readPidFile()).toEqual({
    pid: 123,
    port: 0,
    startedAt: '2026-06-16T00:00:00.000Z',
    name: 'oracle-http',
  });
});

function mkdtemp(): string {
  const dir = join(tmpdir(), `arra-pid-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  tempDirs.push(dir);
  return dir;
}
