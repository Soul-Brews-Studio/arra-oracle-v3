import type { ToolResponse } from '../tools/types.ts';

export const GUIDE_TOOL_NAME = '____IMPORTANT';

export type GuideToolSummary = Readonly<{
  name: string;
  description: string;
  readOnly: boolean;
  remoteWriteSafe: boolean;
}>;

export function guideToolDefinition() {
  return {
    name: GUIDE_TOOL_NAME,
    description: 'Lists only Oracle tools visible to this seat.',
    inputSchema: { type: 'object', properties: {} },
  };
}

export function guideToolResponse(version: string, tools: readonly GuideToolSummary[]): ToolResponse {
  const lines = tools
    .filter((tool) => tool.name !== GUIDE_TOOL_NAME)
    .map((tool) => {
      const access = tool.remoteWriteSafe
        ? 'bounded owner-core write; never writes the local read-only database'
        : tool.readOnly ? 'read' : 'write';
      return `- ${tool.name} [${access}] — ${tool.description}`;
    });
  return {
    content: [{
      type: 'text',
      text: `ORACLE WORKFLOW GUIDE (v${version})\n\nVisible tools for this seat:\n${lines.join('\n')}`,
    }],
  };
}
