import { describe, expect, test } from 'bun:test';
import type { ToolResponse } from '../../../tools/types.ts';
import { bridgeTraceToGithubEvidence, mapTraceGithubEvidence } from '../trace-bridge.ts';

const toolJson = (value: unknown): ToolResponse => ({
  content: [{ type: 'text', text: JSON.stringify(value) }],
});

describe('oracle dig trace bridge', () => {
  test('calls trace core handlers and maps dig points to github evidence', async () => {
    const calls: string[] = [];
    const result = await bridgeTraceToGithubEvidence({
      findingId: 'finding-1',
      tenantId: 'tenant-a',
      asOfCommit: 'abc123',
      createdAt: 1234,
      trace: {
        query: 'phase 3 bridge',
        project: 'github.com/Soul-Brews-Studio/arra-oracle-v3',
        foundFiles: [{ path: 'src/plugins/oracle-dig/trace-bridge.ts:42', type: 'other' }],
        foundCommits: [{ hash: 'deadbeef', shortHash: 'deadbee', date: '2026-07-12', message: 'bridge' }],
        foundIssues: [{ number: 2771, title: 'schema', state: 'closed', url: 'https://github.com/Soul-Brews-Studio/arra-oracle-v3/issues/2771' }],
      },
    }, {
      handleTrace: async (input) => {
        calls.push(`trace:${input.query}`);
        return toolJson({ success: true, trace_id: 'trace-1' });
      },
      handleTraceList: async (input) => {
        calls.push(`list:${input.query}`);
        return toolJson({ traces: [{ trace_id: 'trace-1' }], total: 1, has_more: false });
      },
    });

    expect(calls).toEqual(['trace:phase 3 bridge', 'list:phase 3 bridge']);
    expect(result.traceId).toBe('trace-1');
    expect(result.evidenceRows).toEqual([
      expect.objectContaining({
        findingId: 'finding-1', tenantId: 'tenant-a', kind: 'github',
        githubOwner: 'Soul-Brews-Studio', githubRepo: 'arra-oracle-v3',
        githubPath: 'src/plugins/oracle-dig/trace-bridge.ts', githubLine: 42,
        githubRef: 'abc123', commit: 'abc123', createdAt: 1234,
      }),
      expect.objectContaining({
        githubOwner: 'Soul-Brews-Studio', githubRepo: 'arra-oracle-v3',
        githubRef: 'deadbeef', commit: 'deadbeef', kind: 'github',
      }),
      expect.objectContaining({
        githubOwner: 'Soul-Brews-Studio', githubRepo: 'arra-oracle-v3',
        githubPath: 'issues/2771', githubRef: '#2771', kind: 'github',
      }),
    ]);
  });

  test('does not treat local multi-segment paths as owner/repo paths', () => {
    const [row] = mapTraceGithubEvidence({
      findingId: 'finding-local',
      trace: { query: 'local', foundFiles: [{ path: 'src/routes/health/index.ts#L7', type: 'other' }] },
      createdAt: 77,
    });
    expect(row).toEqual(expect.objectContaining({
      githubPath: 'src/routes/health/index.ts',
      githubLine: 7,
      githubOwner: undefined,
      githubRepo: undefined,
      kind: 'github',
      createdAt: 77,
    }));
  });
});
