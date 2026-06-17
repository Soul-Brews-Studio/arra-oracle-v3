import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { mcpTools } from '../../src/tools/mcp-manifest.ts';
import { mcpRestMap, mcpRestMapByName, remoteableMcpRestMap } from '../../src/tools/mcp-rest-map.ts';

describe('pure MCP REST map', () => {
  test('has no imports and stays free of Bun-only tool/db/vector dependencies', () => {
    const source = readFileSync('src/tools/mcp-rest-map.ts', 'utf8');

    expect(source).not.toMatch(/^import\s/m);
    expect(source).not.toMatch(/from ['"].*(tools|db|vector)/);
    expect(source).not.toContain('bun:sqlite');
    expect(source).not.toContain('@lancedb');
  });

  test('covers every core MCP tool name exactly once', () => {
    const manifestNames = mcpTools.map((tool) => tool.name).sort();
    const restNames = mcpRestMap.map((entry) => entry.name).sort();

    expect(new Set(restNames).size).toBe(restNames.length);
    expect(restNames).toEqual(manifestNames);
  });

  test('marks remoteable tools with concrete REST request metadata', () => {
    expect(remoteableMcpRestMap.length).toBeGreaterThan(0);
    for (const entry of remoteableMcpRestMap) {
      expect(entry.path).toStartWith('/api/');
      expect(['GET', 'POST', 'PATCH', 'DELETE']).toContain(entry.method);
      expect(entry.remoteable).toBe(true);
    }
  });

  test('captures known edge-safe and local-only boundaries', () => {
    expect(mcpRestMapByName.get('oracle_search')).toMatchObject({ remoteable: true, method: 'GET', path: '/api/search' });
    expect(mcpRestMapByName.get('oracle_learn')).toMatchObject({ remoteable: true, method: 'POST', path: '/api/learn', body: 'args' });
    expect(mcpRestMapByName.get('oracle_trace_get')).toMatchObject({ remoteable: true, path: '/api/traces/:traceId' });
    expect(mcpRestMapByName.get('oracle_research_note')).toMatchObject({ remoteable: false });
    expect(mcpRestMapByName.get('oracle_mcp_call')).toMatchObject({ remoteable: false });
  });
});
