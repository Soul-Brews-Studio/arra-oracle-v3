import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectGhqRoot } from '../ghq-root.ts';

const savedEnv = {
  GHQ_ROOT: process.env.GHQ_ROOT,
  PATH: process.env.PATH,
  HOME: process.env.HOME,
};
const tempDirs: string[] = [];

function tempDir(prefix: string) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('detectGhqRoot', () => {
  test('GHQ_ROOT env var wins over everything', () => {
    process.env.GHQ_ROOT = '/explicit/ghq';
    expect(detectGhqRoot('/anything')).toBe('/explicit/ghq');
  });

  test('without ghq or git on PATH, falls back to ~/ghq when it exists', () => {
    delete process.env.GHQ_ROOT;
    process.env.PATH = '/nonexistent-bin';
    const home = tempDir('ghq-home-');
    process.env.HOME = home;
    fs.mkdirSync(path.join(home, 'ghq'));
    expect(detectGhqRoot('/some/repo')).toBe(path.join(home, 'ghq'));
  });

  test('last resort derives root from a github.com repo path', () => {
    delete process.env.GHQ_ROOT;
    process.env.PATH = '/nonexistent-bin';
    process.env.HOME = tempDir('ghq-home-'); // no ~/ghq inside
    expect(detectGhqRoot('/srv/ghq/github.com/org/repo')).toBe('/srv/ghq');
  });
});
