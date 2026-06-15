import { expect, test } from 'bun:test';
import { guideToolResponse } from '../../src/mcp/guide.ts';

test('MCP guide response includes versioned workflow help', () => {
  expect(guideToolResponse('1.2.3').content[0].text).toContain('ORACLE WORKFLOW GUIDE (v1.2.3)');
});
