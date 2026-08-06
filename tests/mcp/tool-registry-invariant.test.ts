import { describe, expect, test } from 'bun:test';
import {
  ALL_TOOL_NAMES,
  ALWAYS_ON_TOOLS,
  getDisabledTools,
  type ToolGroupConfig,
} from '../../src/config/tool-groups.ts';
import { mcpTools } from '../../src/tools/mcp-manifest.ts';

const ALL_GROUPS_ON: ToolGroupConfig = {
  search: true, knowledge: true, session: true,
  forum: true, oracle: true, trace: true, standalone: true,
};

/**
 * A built-in tool the config system does not know about cannot be turned off.
 * src/mcp/server.ts re-appends every registry tool with `enabledByDefault !== false`
 * that the whitelist did not name, so anything outside ALL_TOOL_NAMES is exposed
 * unconditionally — which is exactly how oracle_ask, oracle_recap and the two
 * bridge tools drifted out of reach in #2822.
 *
 * If you add a tool to `mcpTools`, give it a TOOL_GROUPS home (or add it to
 * ALWAYS_ON_TOOLS with a stated reason). These tests are the guard.
 */
describe('MCP tool registry ↔ tool-group config invariant', () => {
  test('every built-in MCP tool is governed by the config vocabulary', () => {
    const orphans = mcpTools.map((tool) => tool.name).filter((name) => !ALL_TOOL_NAMES.has(name));
    expect(orphans).toEqual([]);
  });

  test('every built-in MCP tool can actually be disabled by config', () => {
    const unreachable = mcpTools
      .map((tool) => tool.name)
      .filter((name) => !getDisabledTools({ ...ALL_GROUPS_ON, disabled_tools: [name] }).has(name));
    expect(unreachable).toEqual([]);
  });

  test('always-on tools are declared, not accidental', () => {
    for (const name of ALWAYS_ON_TOOLS) {
      expect(ALL_TOOL_NAMES.has(name)).toBe(true);
      expect(mcpTools.some((tool) => tool.name === name)).toBe(true);
    }
  });
});
