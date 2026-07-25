import { afterEach, beforeEach, expect, test } from 'bun:test';
import { applyToolEnvOverrides, type ToolGroupConfig } from '../../src/config/tool-groups.ts';
import { resetAliasWarnings } from '../../src/config/tool-alias-warn.ts';

// ORACLE_ENABLED_TOOLS / ORACLE_DISABLED_TOOLS are the third inbound surface that
// rewrites muninn_ names — the only lever available on a read-only container, and
// silent before this change.
const saved = {
  allow: process.env.ORACLE_ENABLED_TOOLS,
  block: process.env.ORACLE_DISABLED_TOOLS,
};

const BASE: ToolGroupConfig = {
  search: true, knowledge: true, session: true, forum: true,
  oracle: true, trace: true, standalone: true, mcp: true,
};

beforeEach(() => {
  resetAliasWarnings();
  delete process.env.ORACLE_ENABLED_TOOLS;
  delete process.env.ORACLE_DISABLED_TOOLS;
});

afterEach(() => {
  for (const [key, value] of [
    ['ORACLE_ENABLED_TOOLS', saved.allow], ['ORACLE_DISABLED_TOOLS', saved.block],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function applyCapturingWarnings(): { warnings: string[]; next: ToolGroupConfig } {
  const lines: string[] = [];
  const real = console.error;
  console.error = (...args: unknown[]) => { lines.push(args.join(' ')); };
  try {
    const next = applyToolEnvOverrides({ ...BASE });
    return { warnings: lines.filter((line) => line.includes('is deprecated')), next };
  } finally {
    console.error = real;
  }
}

test('ORACLE_ENABLED_TOOLS warns on a muninn_ name and still resolves it', () => {
  process.env.ORACLE_ENABLED_TOOLS = 'muninn_search,arra_read,oracle_list';
  const { warnings, next } = applyCapturingWarnings();

  // arra_read rides along in the same list and must NOT produce a line.
  expect(warnings).toEqual([
    '[MCP] tool alias "muninn_search" is deprecated — use "oracle_search" (removal planned next release)',
  ]);
  expect(next.enabled_tools).toEqual(['oracle_search', 'oracle_read', 'oracle_list']);
});

test('ORACLE_DISABLED_TOOLS warns on a muninn_ name and still resolves it', () => {
  process.env.ORACLE_DISABLED_TOOLS = 'muninn_read';
  const { warnings, next } = applyCapturingWarnings();

  expect(warnings).toEqual([
    '[MCP] tool alias "muninn_read" is deprecated — use "oracle_read" (removal planned next release)',
  ]);
  expect(next.disabled_tools).toContain('oracle_read');
});

test('an all-arra_ env list stays completely silent', () => {
  process.env.ORACLE_ENABLED_TOOLS = 'arra_search,arra_read';
  const { warnings, next } = applyCapturingWarnings();

  expect(warnings).toEqual([]);
  expect(next.enabled_tools).toEqual(['oracle_search', 'oracle_read']);
});
