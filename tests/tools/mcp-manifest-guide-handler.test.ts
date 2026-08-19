import { expect, test } from 'bun:test';
import { mcpToolByName } from '../../src/tools/mcp-manifest.ts';

test('MCP manifest guide handler returns versioned guide text from the runtime catalog', async () => {
  const response = await mcpToolByName.get('____IMPORTANT')!.handler({}, {
    version: '9.9.9',
    getToolCtx: async () => { throw new Error('unused'); },
    getAvailableToolSummaries: async () => [{
      name: 'visible_write',
      description: 'Visible write tool',
      readOnly: false,
      remoteWriteSafe: false,
    }],
  });
  expect(response.content[0].text).toContain('(v9.9.9)');
  expect(response.content[0].text).toContain('visible_write [write]');
});
