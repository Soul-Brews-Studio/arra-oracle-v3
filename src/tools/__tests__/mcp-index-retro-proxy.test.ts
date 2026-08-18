import { describe, expect, it } from 'bun:test';
import { proxyRequestForTool } from '../../mcp/http-proxy.ts';
import { mcpRestMapByName } from '../mcp-rest-map.ts';

describe('oracle_index_retro HTTP proxy mapping', () => {
  it('uses only the bounded retro-file reindex scope', () => {
    expect(mcpRestMapByName.get('oracle_index_retro')).toMatchObject({
      remoteable: true,
      method: 'POST',
      path: '/api/v1/indexer/reindex',
      body: 'retro-file',
    });

    expect(proxyRequestForTool('oracle_index_retro', {
      repoRoot: '/oracle/root',
      filePath: '/oracle/root/ψ/memory/retrospectives/2026-08/18/test.md',
      scope: 'all',
      wait: false,
    })).toEqual({
      method: 'POST',
      path: '/api/v1/indexer/reindex',
      query: {},
      body: {
        repoRoot: '/oracle/root',
        filePath: '/oracle/root/ψ/memory/retrospectives/2026-08/18/test.md',
        scope: 'retro-file',
        wait: true,
      },
    });
  });
});
