import { describe, expect, it } from 'bun:test';

import { mcpRestMap, remoteableMcpRestMap } from '../../../src/tools/mcp-rest-map.ts';
import { workerMcpToolEntries } from '../src/tools.ts';

describe('workers/mcp tool registration parity', () => {
  it('registers every current remoteable MCP REST tool and nothing else', () => {
    const expected = remoteableMcpRestMap.map((entry) => entry.name).sort();
    const registered = workerMcpToolEntries.map((entry) => entry.name).sort();

    expect(registered).toEqual(expected);

    const localOnly = mcpRestMap.filter((entry) => !entry.remoteable).map((entry) => entry.name);
    for (const name of localOnly) {
      expect(registered.includes(name)).toBe(false);
    }
  });
});
