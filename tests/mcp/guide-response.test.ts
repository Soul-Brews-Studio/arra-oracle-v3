import { expect, test } from 'bun:test';
import { GUIDE_TOOL_NAME, guideToolResponse } from '../../src/mcp/guide.ts';

const tool = (name: string, readOnly = true, remoteWriteSafe = false) => ({
  name,
  description: `${name} description`,
  readOnly,
  remoteWriteSafe,
});

test('lists only supplied catalog summaries', () => {
  const text = guideToolResponse('1.2.3', [
    tool(GUIDE_TOOL_NAME),
    tool('oracle_search'),
    tool('oracle_read'),
    tool('ordinary_write', false, false),
  ]).content[0].text;
  expect(text).not.toContain(GUIDE_TOOL_NAME);
  expect(text).toContain('oracle_search');
  expect(text).toContain('oracle_read');
  expect(text).toContain('ordinary_write [write]');
  expect(text).not.toContain('oracle_learn');
  expect(text).not.toContain('oracle_supersede');
});

test('labels bounded owner-core access honestly', () => {
  const text = guideToolResponse('1.2.3', [tool('oracle_index_retro', false, true)]).content[0].text;
  expect(text).toContain('bounded owner-core write');
  expect(text).toContain('never writes the local read-only database');
});
