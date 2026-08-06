type Fetcher = typeof fetch;
type InvokeResult = { ok: boolean; output?: string; error?: string };
type ParsedMcp = { tool: string; url: string; input: Record<string, unknown> };

type Env = Record<string, string | undefined>;

export const MCP_CLIENT_HELP = 'mcp-call <tool> [--url URL] [--json JSON|--arg k=v]';

function flagValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}


function firstPositional(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      if (args[i + 1] && !args[i + 1].startsWith('--')) i++;
      continue;
    }
    return args[i];
  }
}

function envUrl(env: Env): string | undefined {
  return env.ARRA_MCP_URL || env.ORACLE_MCP_URL || env.MCP_SERVER_URL;
}

function parseJson(value: string | undefined): Record<string, unknown> {
  if (!value) return {};
  const data = JSON.parse(value);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('--json must be an object');
  return data as Record<string, unknown>;
}

function parseArgs(values: string[]): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const value of values) {
    const at = value.indexOf('=');
    if (at <= 0) throw new Error('--arg must be key=value');
    input[value.slice(0, at)] = value.slice(at + 1);
  }
  return input;
}

function parseMcp(args: string[], env: Env): ParsedMcp {
  const tool = flagValue(args, '--tool') || firstPositional(args);
  if (!tool) throw new Error('MCP tool name required');
  const url = flagValue(args, '--url') || flagValue(args, '--endpoint') || envUrl(env);
  if (!url) throw new Error('MCP endpoint required: pass --url or set ARRA_MCP_URL');
  const json = parseJson(flagValue(args, '--json'));
  const argValues = args.flatMap((arg, index) => arg === '--arg' && args[index + 1] ? [args[index + 1]] : []);
  return { tool, url, input: { ...json, ...parseArgs(argValues) } };
}

function formatMcpResponse(data: unknown): string {
  const payload = data && typeof data === 'object' && 'result' in data ? (data as { result: unknown }).result : data;
  if (payload && typeof payload === 'object' && Array.isArray((payload as { content?: unknown }).content)) {
    const text = (payload as { content: Array<{ text?: unknown }> }).content
      .map((item) => typeof item.text === 'string' ? item.text : '')
      .filter(Boolean);
    if (text.length) return text.join('\n');
  }
  return JSON.stringify(payload, null, 2);
}

export async function runMcpCall(args: string[], env: Env = process.env, fetcher: Fetcher = fetch): Promise<InvokeResult> {
  try {
    const parsed = parseMcp(args, env);
    const res = await fetcher(parsed.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'arra-maw-plugin', method: 'tools/call', params: { name: parsed.tool, arguments: parsed.input } }),
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
    if (data?.error) throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
    return { ok: true, output: formatMcpResponse(data) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
