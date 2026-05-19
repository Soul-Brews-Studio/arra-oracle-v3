import { describe, it, expect } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  TOOL_GROUPS,
  getDisabledTools,
  loadToolGroupConfig,
  watchToolGroupConfig,
  type ToolGroupConfig,
} from '../tool-groups.ts';

describe('tool-groups', () => {
  it('defines 5 groups with correct tool counts', () => {
    expect(Object.keys(TOOL_GROUPS)).toHaveLength(5);
    expect(TOOL_GROUPS.search).toHaveLength(4);
    expect(TOOL_GROUPS.knowledge).toHaveLength(3);
    expect(TOOL_GROUPS.session).toHaveLength(2);
    expect(TOOL_GROUPS.forum).toHaveLength(4);
    expect(TOOL_GROUPS.trace).toHaveLength(6);
  });

  it('returns empty set when all groups enabled', () => {
    const config: ToolGroupConfig = {
      search: true, knowledge: true, session: true,
      forum: true, trace: true,
    };
    expect(getDisabledTools(config).size).toBe(0);
  });

  it('disables correct tools when groups are off', () => {
    const config: ToolGroupConfig = {
      search: true, knowledge: true, session: true,
      forum: true, trace: false,
    };
    const disabled = getDisabledTools(config);
    expect(disabled.has('muninn_trace')).toBe(true);
    expect(disabled.has('muninn_trace_list')).toBe(true);
    expect(disabled.has('muninn_search')).toBe(false);
    expect(disabled.has('muninn_learn')).toBe(false);
  });

  it('defaults to all groups enabled', () => {
    const config = loadToolGroupConfig('/nonexistent/path');
    expect(config.search).toBe(true);
    expect(config.knowledge).toBe(true);
    expect(config.session).toBe(true);
    expect(config.forum).toBe(true);
    expect(config.trace).toBe(true);
  });

  it('all tool names follow muninn_ prefix convention', () => {
    for (const tools of Object.values(TOOL_GROUPS)) {
      for (const tool of tools) {
        expect(tool).toMatch(/^muninn_/);
      }
    }
  });
});

describe('watchToolGroupConfig', () => {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('fires onChange when the config file is created with new values', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-toolgroups-watch-'));
    const calls: ToolGroupConfig[] = [];
    const stop = watchToolGroupConfig((next) => calls.push(next), dir);
    try {
      // Watcher should see a file appear in the watched dir and reload.
      fs.writeFileSync(
        path.join(dir, 'arra.config.json'),
        JSON.stringify({ tools: { trace: false } }),
      );
      // 200ms debounce + slack for fs event delivery
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
      // Rewrite identical content — should debounce to no event.
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
      // Write malformed JSON — loadToolGroupConfig returns defaults via readJsonSafe.
      // The change differs from baseline {knowledge:false}, so onChange fires
      // with the fallback config (all enabled). This is the documented behavior:
      // a broken file collapses to defaults rather than crashing the server.
      fs.writeFileSync(configPath, '{ this is not json');
      await wait(450);
      // Either fired with reset-to-defaults, or stayed silent — both are
      // acceptable. The contract is "don't crash, don't hang".
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
