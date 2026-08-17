/**
 * A tool that is exported but not listed does not exist.
 *
 * #3017 added three session read tools and #3018 added the summary write tool. Both exported
 * their definitions and handlers from `src/tools/index.ts` — and neither was ever added to
 * `mcp-manifest.ts`, which is the only list `ListTools` reads and `CallTool` dispatches from. So
 * all four shipped unreachable: `oracle_session_summarize` could not be called by the very AI
 * that #3018 was written for, whose title was "so an AI can actually reach it".
 *
 * The last test is the one that matters. Naming the four tools would only pin today's mistake;
 * asserting that EVERY exported `*ToolDef` appears in the manifest catches the next one, written
 * by someone who has never read this file.
 */
import { describe, expect, test } from 'bun:test';
import { mcpTools } from '../../src/tools/mcp-manifest.ts';

const names = new Set(mcpTools.map((tool) => tool.name));

describe('session tools reach MCP', () => {
  test('all four session tools are listed', () => {
    expect(names).toContain('oracle_session_list');
    expect(names).toContain('oracle_session_get');
    expect(names).toContain('oracle_session_search');
    expect(names).toContain('oracle_session_summarize');
  });

  test('each one carries a handler CallTool can dispatch', () => {
    for (const name of ['oracle_session_list', 'oracle_session_get', 'oracle_session_search', 'oracle_session_summarize']) {
      const tool = mcpTools.find((t) => t.name === name);
      expect(tool).toBeDefined();
      expect(typeof tool!.handler).toBe('function');
      expect(tool!.inputSchema).toBeDefined();
    }
  });

  test('the reads are marked read-only and the write is not', () => {
    const readOnly = (name: string) => mcpTools.find((t) => t.name === name)!.readOnly;
    expect(readOnly('oracle_session_list')).toBe(true);
    expect(readOnly('oracle_session_get')).toBe(true);
    expect(readOnly('oracle_session_search')).toBe(true);
    // summarize writes a document; marking it read-only would let a read-only client mutate.
    expect(readOnly('oracle_session_summarize')).toBe(false);
  });

  test('no tool name is registered twice', () => {
    const all = mcpTools.map((t) => t.name);
    expect(all.length).toBe(new Set(all).size);
  });

  /**
   * The general guard: anything exported as a `*ToolDef` from the tool barrel is intended to be a
   * tool, so it must be listed. This is what would have caught #3017 and #3018 at the time.
   */
  test('EVERY exported tool definition appears in the manifest', async () => {
    const barrel = await import('../../src/tools/index.ts') as Record<string, unknown>;

    const missing: string[] = [];
    for (const [exportName, value] of Object.entries(barrel)) {
      if (!exportName.endsWith('ToolDef')) continue;
      const defs = Array.isArray(value) ? value : [value];
      for (const def of defs) {
        const toolName = (def as { name?: string })?.name;
        if (typeof toolName !== 'string') continue;
        if (!names.has(toolName)) missing.push(`${exportName} -> ${toolName}`);
      }
    }

    expect(missing).toEqual([]);
  });
});
