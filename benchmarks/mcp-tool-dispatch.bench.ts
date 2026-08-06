import { runBench } from './harness.ts';
import { mcpToolByName } from '../src/tools/mcp-manifest.ts';

const runtime = {
  version: 'bench',
  getToolCtx: async () => {
    throw new Error('benchmark tool should not request context');
  },
};

await runBench('MCP tool dispatch map lookup + handler', async () => {
  const tool = mcpToolByName.get('____IMPORTANT');
  if (!tool) throw new Error('tool missing');
  const result = await tool.handler({}, runtime);
  if (!result.content?.length) throw new Error('tool dispatch failed');
}, { iterations: 5_000, warmup: 100 });
