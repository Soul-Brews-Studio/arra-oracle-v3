import { describe, it, expect } from 'bun:test';
import { TOOL_GROUPS, getDisabledTools, loadToolGroupConfig, type ToolGroupConfig } from '../tool-groups.ts';

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
    expect(disabled.has('arra_trace')).toBe(true);
    expect(disabled.has('arra_trace_list')).toBe(true);
    expect(disabled.has('arra_search')).toBe(false);
    expect(disabled.has('arra_learn')).toBe(false);
  });

  it('defaults to all groups enabled', () => {
    const config = loadToolGroupConfig('/nonexistent/path');
    expect(config.search).toBe(true);
    expect(config.knowledge).toBe(true);
    expect(config.session).toBe(true);
    expect(config.forum).toBe(true);
    expect(config.trace).toBe(true);
  });

  it('all tool names follow arra_ prefix convention', () => {
    for (const tools of Object.values(TOOL_GROUPS)) {
      for (const tool of tools) {
        expect(tool).toMatch(/^arra_/);
      }
    }
  });
});
