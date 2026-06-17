import type { UnifiedRuntime } from '../plugins/unified-loader.ts';
import type { ToolResponse } from '../tools/types.ts';
import type { RuntimeMcpToolManifest } from '../tools/mcp-manifest.ts';

function isToolResponse(value: unknown): value is ToolResponse {
  return !!value && typeof value === 'object' && Array.isArray((value as ToolResponse).content);
}

async function responseToText(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) return '';
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

async function toToolResponse(result: unknown): Promise<ToolResponse> {
  if (isToolResponse(result)) return result;
  if (result instanceof Response) {
    return { content: [{ type: 'text', text: await responseToText(result) }], isError: !result.ok };
  }
  const record = result && typeof result === 'object' ? result as Record<string, unknown> : null;
  if (record?.ok === false) {
    return { content: [{ type: 'text', text: String(record.error ?? 'plugin failed') }], isError: true };
  }
  const payload = record?.body ?? record?.output ?? result;
  return { content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2) }] };
}

export function pluginMcpToolsFrom(runtime: UnifiedRuntime, reservedNames = new Set<string>()): RuntimeMcpToolManifest[] {
  return runtime.mcpTools
    .filter((tool) => tool.enabled !== false)
    .filter((tool) => !reservedNames.has(tool.name))
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      group: tool.group ?? `plugin:${tool.plugin}`,
      readOnly: tool.readOnly === true,
      enabledByDefault: tool.enabledByDefault !== false,
      handlerId: `${tool.plugin}:${tool.handler}`,
      handler: async (input) => toToolResponse(await runtime.callMcpTool(tool.name, input)),
    }));
}
