import { describe, it, expect } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { watchToolGroupConfig, type ToolGroupConfig } from '../tool-groups.ts';

describe('watchToolGroupConfig', () => {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('fires onChange when the config file is created with new values', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-toolgroups-watch-'));
    const calls: ToolGroupConfig[] = [];
    const stop = watchToolGroupConfig((next) => calls.push(next), dir);
    try {
      fs.writeFileSync(
        path.join(dir, 'arra.config.json'),
        JSON.stringify({ tools: { trace: false } }),
      );
      await wait(450);
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(calls[calls.length - 1].trace).toBe(false);
      expect(calls[calls.length - 1].search).toBe(true);
    } finally {
      stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does NOT fire when the file change is a no-op', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-toolgroups-watch-'));
    const configPath = path.join(dir, 'arra.config.json');
    fs.writeFileSync(configPath, JSON.stringify({ tools: { trace: false } }));
    const calls: ToolGroupConfig[] = [];
    const stop = watchToolGroupConfig((next) => calls.push(next), dir);
    try {
      fs.writeFileSync(configPath, JSON.stringify({ tools: { trace: false } }));
      await wait(450);
      expect(calls.length).toBe(0);
    } finally {
      stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps last good config when JSON is malformed', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-toolgroups-watch-'));
    const configPath = path.join(dir, 'arra.config.json');
    fs.writeFileSync(configPath, JSON.stringify({ tools: { knowledge: false } }));
    const calls: ToolGroupConfig[] = [];
    const stop = watchToolGroupConfig((next) => calls.push(next), dir);
    try {
      fs.writeFileSync(configPath, '{ this is not json');
      await wait(450);
      for (const c of calls) {
        expect(typeof c.search).toBe('boolean');
      }
    } finally {
      stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stop() closes the watchers and prevents further callbacks', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-toolgroups-watch-'));
    const calls: ToolGroupConfig[] = [];
    const stop = watchToolGroupConfig((next) => calls.push(next), dir);
    stop();
    try {
      fs.writeFileSync(
        path.join(dir, 'arra.config.json'),
        JSON.stringify({ tools: { search: false } }),
      );
      await wait(450);
      expect(calls.length).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
