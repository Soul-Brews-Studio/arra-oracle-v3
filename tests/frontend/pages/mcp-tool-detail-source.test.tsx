import { describe, expect, test } from 'bun:test';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { McpToolDetailPage, toolDetailSource } from '../../../frontend/src/pages/McpToolDetailPage';
import type { McpTool } from '../../../frontend/src/types';
import { htmlFor } from '../_render';

const pluginTool: McpTool = {
  name: 'echo.say',
  description: 'Echo a message',
  group: 'echo',
  source: 'plugin',
  plugin: 'echo',
  readOnly: true,
  inputSchema: { type: 'object' },
};

describe('McpToolDetailPage source labels', () => {
  test('normalizes plugin and core source labels', () => {
    expect(toolDetailSource(pluginTool)).toBe('plugin:echo');
    expect(toolDetailSource({ name: 'memory.write', description: '', source: 'core' })).toBe('core');
  });

  test('renders ready-state plugin source details from initial tools', () => {
    const html = htmlFor(
      <MemoryRouter initialEntries={['/mcp/tools/echo.say']}>
        <Routes>
          <Route path="/mcp/tools/:name" element={<McpToolDetailPage initialTools={[pluginTool]} />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(html).toContain('echo.say');
    expect(html).toContain('plugin:echo');
    expect(html).toContain('Input schema');
  });
});
