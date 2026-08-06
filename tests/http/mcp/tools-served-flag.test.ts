/**
 * `GET /api/v1/mcp/tools` is a catalogue, and it must say which entries are actually served.
 *
 * It listed every core tool from the static `mcpRestMap` and never consulted the tool-groups
 * config. Measured on a real machine: **32 tools listed, 2 reachable over MCP** — the config
 * had `enabled_tools: ["oracle_search", "oracle_learn"]`. Nothing in the payload expressed
 * that gap, and the field that looks like it should (`enabledByDefault`) is the tool's own
 * manifest default, not the live answer.
 *
 * Filtering the list would be the wrong fix: `/tools/config` needs disabled tools present in
 * order to offer them for enabling. So each entry is marked instead, and the response carries
 * a `served` count beside `total`.
 *
 * Same declared-but-not-true family as #2822 (levers that turn nothing) and #2870 (the root
 * endpoint advertising a 404).
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { createMcpRoutes } from '../../../src/routes/mcp/tools.ts';
import { getEnabledToolNames, loadToolGroupConfig } from '../../../src/config/tool-groups-core.ts';

type ToolsPayload = {
  tools: Array<{ name: string; served?: boolean; enabledByDefault?: boolean }>;
  total: number;
  served: number;
};

/**
 * The served set is injected rather than written to a temp config directory. An earlier draft
 * did the latter and silently read the DEVELOPER'S OWN config instead: `ORACLE_DATA_DIR` is a
 * module constant resolved at import time, so setting the env var inside a test changes
 * nothing. #2837 is the same lesson.
 */
let served: string[] = [];

afterEach(() => {
  served = [];
});

function withServed(names: string[]): void {
  served = names;
}

async function fetchTools(): Promise<ToolsPayload> {
  const app = createMcpRoutes({ pluginTools: [], servedToolNames: () => served });
  const res = await app.handle(new Request('http://local/api/mcp/tools'));
  const body = (await res.json()) as ToolsPayload | { data: ToolsPayload };
  return 'data' in body && body.data ? body.data : (body as ToolsPayload);
}

describe('the tool catalogue reports what is actually served', () => {
  test('every entry carries a served flag', async () => {
    withServed(['oracle_search', 'oracle_learn']);
    const payload = await fetchTools();

    expect(payload.tools.length).toBeGreaterThan(0);
    expect(payload.tools.every((tool) => typeof tool.served === 'boolean')).toBe(true);
  });

  test('a narrow allow-list is reflected — this was 32 listed against 2 served', async () => {
    withServed(['oracle_search', 'oracle_learn']);
    const payload = await fetchTools();

    const served = payload.tools.filter((tool) => tool.served).map((tool) => tool.name);
    expect(served.sort()).toEqual(['oracle_learn', 'oracle_search']);
    expect(payload.served).toBe(2);
  });

  test('the catalogue still lists disabled tools — /tools/config needs them to offer', async () => {
    withServed(['oracle_search']);
    const payload = await fetchTools();

    // The fix must not be "filter the list".
    expect(payload.total).toBeGreaterThan(payload.served);
    expect(payload.tools.some((tool) => tool.served === false)).toBe(true);
  });

  test('served and total disagree when the config is narrow, and that is visible', async () => {
    withServed(['oracle_search']);
    const payload = await fetchTools();

    expect(payload.served).toBe(1);
    expect(payload.total).toBe(payload.tools.length);
    expect(payload.served).toBeLessThan(payload.total);
  });

  test('a permissive config serves more than a narrow one', async () => {
    withServed(['oracle_search']);
    const narrow = (await fetchTools()).served;

    withServed(getEnabledToolNames(loadToolGroupConfig(undefined, '/nonexistent-dir')));
    const wide = (await fetchTools()).served;

    expect(wide).toBeGreaterThan(narrow);
  });

  test('served is not merely a copy of enabledByDefault', async () => {
    // The distinction that made the old payload misleading: a tool can be enabled by default
    // in its manifest and still not be served by the running config.
    withServed(['oracle_search']);
    const payload = await fetchTools();

    const defaultOnButNotServed = payload.tools.filter(
      (tool) => tool.enabledByDefault === true && tool.served === false,
    );
    expect(defaultOnButNotServed.length).toBeGreaterThan(0);
  });
});
