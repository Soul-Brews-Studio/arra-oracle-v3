/**
 * Two regressions shipped by #2826 and caught by adversarial verification of
 * #2822, both on the `applyToolEnvOverrides` path.
 *
 * 1. **An allow-list naming only unrecognised tools served ZERO tools.**
 *    `ORACLE_ENABLED_TOOLS=oracle_dig` emptied the entire MCP surface —
 *    and `oracle_dig` is a name the product advertises at
 *    `GET /api/v1/mcp/tools`. It is a *plugin* tool, so it lives outside
 *    `ALL_TOOL_NAMES` (the orphan class #2822 is itself about), which made a
 *    plausible value silently disable everything.
 *    A filter that matches nothing means "no usable filter", not "allow nothing".
 *
 * 2. **`knownTool()` logged unguarded on the 10 Hz watcher path** —
 *    `tool-groups-watch.ts` polls `loadToolGroupConfig` every 100ms, so one
 *    unrecognised name emitted ~864,000 stderr lines/day. The repo already
 *    documents that exact figure in `tool-alias-warn.ts`, and already enforced
 *    it for the alias branch — #2826 added an unguarded branch three lines away.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnabledToolNames, loadToolGroupConfig } from '../../src/config/tool-groups-core.ts';
import { resetAliasWarnings } from '../../src/config/tool-alias-warn.ts';

const EMPTY_DATA = mkdtempSync(join(tmpdir(), 'tool-env-safety-'));
const NO_REPO = '/nonexistent/repo/root';

const previous = {
  allow: process.env.ORACLE_ENABLED_TOOLS,
  block: process.env.ORACLE_DISABLED_TOOLS,
};

function served(): string[] {
  return getEnabledToolNames(loadToolGroupConfig(NO_REPO, EMPTY_DATA));
}

function countingConsole(match: string) {
  const original = console.error;
  let lines = 0;
  console.error = (...args: unknown[]) => {
    if (String(args[0] ?? '').includes(match)) lines += 1;
  };
  return { get lines() { return lines; }, restore: () => { console.error = original; } };
}

beforeEach(() => {
  delete process.env.ORACLE_ENABLED_TOOLS;
  delete process.env.ORACLE_DISABLED_TOOLS;
  resetAliasWarnings();
});

afterEach(() => {
  for (const [key, value] of [
    ['ORACLE_ENABLED_TOOLS', previous.allow],
    ['ORACLE_DISABLED_TOOLS', previous.block],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('ORACLE_ENABLED_TOOLS cannot silently disable everything', () => {
  test('an allow-list of only unrecognised names is ignored, not obeyed', () => {
    const baseline = served().length;
    expect(baseline).toBeGreaterThan(0);

    process.env.ORACLE_ENABLED_TOOLS = 'oracle_dig';
    expect(served().length).toBe(baseline);
  });

  test('a plausible plugin-tool name does not empty the surface', () => {
    // oracle_dig is advertised by GET /api/v1/mcp/tools but is a plugin tool,
    // so it is absent from ALL_TOOL_NAMES. Before the fix this served 0 tools.
    process.env.ORACLE_ENABLED_TOOLS = 'oracle_dig,oracle_sessions';
    expect(served().length).toBeGreaterThan(0);
  });

  test('a partly-valid allow-list still filters to the valid names', () => {
    process.env.ORACLE_ENABLED_TOOLS = 'oracle_search,typo_name';
    expect(served()).toEqual(['oracle_search']);
  });

  test('a fully-valid allow-list is unchanged in behaviour', () => {
    process.env.ORACLE_ENABLED_TOOLS = 'oracle_search,oracle_read';
    expect(new Set(served())).toEqual(new Set(['oracle_search', 'oracle_read']));
  });

  test('ignoring an unusable allow-list is announced, not silent', () => {
    const spy = countingConsole('named no recognised tool');
    try {
      process.env.ORACLE_ENABLED_TOOLS = 'oracle_dig';
      served();
      expect(spy.lines).toBe(1);
    } finally {
      spy.restore();
    }
  });
});

describe('unknown-tool warnings are once per process, not once per poll', () => {
  test('20 loads emit one line, not 20', () => {
    // 20 loads is 2 seconds of the 100ms watcher poll. Unguarded this was
    // ~864,000 lines/day — the figure tool-alias-warn.ts documents.
    const spy = countingConsole('unknown tool');
    try {
      process.env.ORACLE_DISABLED_TOOLS = 'definitely_not_a_tool';
      for (let i = 0; i < 20; i += 1) loadToolGroupConfig(NO_REPO, EMPTY_DATA);
      expect(spy.lines).toBe(1);
    } finally {
      spy.restore();
    }
  });

  test('distinct unknown names each warn once', () => {
    const spy = countingConsole('unknown tool');
    try {
      process.env.ORACLE_DISABLED_TOOLS = 'not_a_tool_a,not_a_tool_b';
      for (let i = 0; i < 5; i += 1) loadToolGroupConfig(NO_REPO, EMPTY_DATA);
      expect(spy.lines).toBe(2);
    } finally {
      spy.restore();
    }
  });
});
