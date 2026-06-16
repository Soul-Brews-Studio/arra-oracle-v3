import { describe, expect, test } from 'bun:test';
import { filterAdvertisedTools } from '../index.ts';

describe('filterAdvertisedTools', () => {
  const tools = [
    { name: '____IMPORTANT' },
    { name: 'oracle_search' },
    { name: 'oracle_learn' },
    { name: 'oracle_trace_get' },
  ];

  test('hides disabled MCP tools from tools/list output', () => {
    const listed = filterAdvertisedTools(tools, new Set(['oracle_learn', 'oracle_trace_get']));
    const names = listed.map((t) => t.name);

    expect(names).toContain('oracle_search');
    expect(names).not.toContain('oracle_learn');
    expect(names).not.toContain('oracle_trace_get');
  });

  test('can hide the meta guide tool for strict allow-lists', () => {
    const listed = filterAdvertisedTools(tools, new Set(['____IMPORTANT', 'oracle_learn', 'oracle_trace_get']));
    expect(listed.map((t) => t.name)).toEqual(['oracle_search']);
  });
});
