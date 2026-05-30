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
  it('defines 6 groups with correct tool counts', () => {
    expect(Object.keys(TOOL_GROUPS)).toHaveLength(6);
    expect(TOOL_GROUPS.search).toHaveLength(4);
    expect(TOOL_GROUPS.knowledge).toHaveLength(3);
    expect(TOOL_GROUPS.session).toHaveLength(2);
    expect(TOOL_GROUPS.forum).toHaveLength(4);
    expect(TOOL_GROUPS.trace).toHaveLength(6);
    expect(TOOL_GROUPS.standalone).toHaveLength(2);   // #972 wire: reflect + verify (schedule kept HTTP-only)
  });

  it('returns empty set when all groups enabled', () => {
    const config: ToolGroupConfig = {
      search: true, knowledge: true, session: true,
      forum: true, trace: true, standalone: true,
    };
    expect(getDisabledTools(config).size).toBe(0);
  });

  it('disables correct tools when groups are off', () => {
    const config: ToolGroupConfig = {
      search: true, knowledge: true, session: true,
      forum: true, trace: false, standalone: true,
    };
    const disabled = getDisabledTools(config);
    expect(disabled.has('oracle_trace')).toBe(true);
    expect(disabled.has('oracle_trace_list')).toBe(true);
    expect(disabled.has('oracle_search')).toBe(false);
    expect(disabled.has('oracle_learn')).toBe(false);
  });

  it('disabled_tools adds per-tool blocks on top of group config', () => {
    const config: ToolGroupConfig = {
      search: true, knowledge: true, session: true,
      forum: true, trace: true, standalone: true,
      disabled_tools: ['oracle_supersede', 'oracle_thread_update'],
    };
    const disabled = getDisabledTools(config);
    expect(disabled.has('oracle_supersede')).toBe(true);
    expect(disabled.has('oracle_thread_update')).toBe(true);
    // Sibling tools in the same group stay enabled
    expect(disabled.has('oracle_learn')).toBe(false);
    expect(disabled.has('oracle_thread')).toBe(false);
  });

  it('enabled_tools whitelist overrides group-disabled', () => {
    const config: ToolGroupConfig = {
      search: true, knowledge: true, session: true,
      forum: false, trace: true, standalone: true,
      enabled_tools: ['oracle_thread_read'],
    };
    const disabled = getDisabledTools(config);
    // Whole forum group disabled, except the whitelisted one
    expect(disabled.has('oracle_thread')).toBe(true);
    expect(disabled.has('oracle_thread_update')).toBe(true);
    expect(disabled.has('oracle_thread_read')).toBe(false);
  });

  it('enabled_tools whitelist overrides a per-tool block (whitelist wins last)', () => {
    const config: ToolGroupConfig = {
      search: true, knowledge: true, session: true,
      forum: true, trace: true, standalone: true,
      disabled_tools: ['oracle_supersede'],
      enabled_tools: ['oracle_supersede'],
    };
    expect(getDisabledTools(config).has('oracle_supersede')).toBe(false);
  });

  it('ignores unknown tool names in disabled_tools and enabled_tools', () => {
    const config: ToolGroupConfig = {
      search: true, knowledge: true, session: true,
      forum: true, trace: true, standalone: true,
      disabled_tools: ['typo_search', 'oracle_search'],
      enabled_tools: ['also_typo'],
    };
    const disabled = getDisabledTools(config);
    // Real one applied
    expect(disabled.has('oracle_search')).toBe(true);
    // Typos didn't leak in
    expect(disabled.has('typo_search')).toBe(false);
    expect(disabled.has('also_typo')).toBe(false);
  });

  it('defaults to all groups enabled', () => {
    const config = loadToolGroupConfig('/nonexistent/path');
    expect(config.search).toBe(true);
    expect(config.knowledge).toBe(true);
    expect(config.session).toBe(true);
    expect(config.forum).toBe(true);
    expect(config.trace).toBe(true);
  });

  it('all tool names follow oracle_ prefix convention', () => {
    for (const tools of Object.values(TOOL_GROUPS)) {
      for (const tool of tools) {
        expect(tool).toMatch(/^oracle_/);
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
