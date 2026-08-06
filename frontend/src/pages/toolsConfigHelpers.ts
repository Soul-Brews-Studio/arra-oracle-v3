import { fetchJson } from './vectorSettingsHelpers';

/**
 * Shape of GET /api/v1/settings/tools — see src/routes/settings/tools.ts
 * (serializeToolConfig). The route was defined but never mounted until #2822;
 * this page is the first consumer.
 */
export interface ToolEntry {
  name: string;
  enabled: boolean;
}

export interface ToolGroupEntry {
  group: string;
  tools: ToolEntry[];
}

export interface ToolConfigResponse {
  groups: ToolGroupEntry[];
  enabled_tools: string[];
  disabled_tools: string[];
  /** No group — on by default, still disableable. ALWAYS_ON_TOOLS in tool-groups-core.ts. */
  always_on_tools: string[];
  /** The file a PUT will write. First-match-wins, so this may not be the global one. */
  config_path: string;
  config_exists: boolean;
  /** ORACLE_ENABLED_TOOLS / ORACLE_DISABLED_TOOLS in effect — env beats the file. */
  env_override: boolean;
}

const TOOLS_ENDPOINT = '/api/v1/settings/tools';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function asGroups(value: unknown): ToolGroupEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!isRecord(raw) || typeof raw.group !== 'string') return [];
    const tools = Array.isArray(raw.tools)
      ? raw.tools.flatMap((t) =>
          isRecord(t) && typeof t.name === 'string'
            ? [{ name: t.name, enabled: t.enabled === true }]
            : [],
        )
      : [];
    return [{ group: raw.group, tools }];
  });
}

/**
 * Parse defensively rather than casting. `fetchJson` returns `payload as T`,
 * so a shape change would otherwise surface as a silent `undefined` at render
 * time instead of an error here — the exact failure mode #2821 documents.
 */
export function parseToolConfig(body: unknown): ToolConfigResponse {
  if (!isRecord(body)) throw new Error(`${TOOLS_ENDPOINT} returned a non-object payload`);
  const groups = asGroups(body.groups);
  if (groups.length === 0) throw new Error(`${TOOLS_ENDPOINT} returned no tool groups`);
  return {
    groups,
    enabled_tools: asStringList(body.enabled_tools),
    disabled_tools: asStringList(body.disabled_tools),
    always_on_tools: asStringList(body.always_on_tools),
    config_path: typeof body.config_path === 'string' ? body.config_path : '',
    config_exists: body.config_exists === true,
    env_override: body.env_override === true,
  };
}

export async function loadToolConfig(): Promise<ToolConfigResponse> {
  return parseToolConfig(await fetchJson<unknown>(TOOLS_ENDPOINT));
}

/** PUT takes the full allow-list — anything omitted becomes disabled. */
export async function saveEnabledTools(enabled: string[]): Promise<ToolConfigResponse> {
  const body = await fetchJson<unknown>(TOOLS_ENDPOINT, {
    method: 'PUT',
    body: JSON.stringify({ enabled_tools: enabled }),
  });
  return parseToolConfig(body);
}

/** Flip one tool and return the allow-list to submit. */
export function toggleTool(config: ToolConfigResponse, name: string): string[] {
  const enabled = new Set(config.enabled_tools);
  if (enabled.has(name)) enabled.delete(name);
  else enabled.add(name);
  return [...enabled];
}

/** Flip a whole group at once — off if any member is on, otherwise on. */
export function toggleGroup(config: ToolConfigResponse, group: string): string[] {
  const entry = config.groups.find((g) => g.group === group);
  if (!entry) return config.enabled_tools;
  const enabled = new Set(config.enabled_tools);
  const anyOn = entry.tools.some((t) => enabled.has(t.name));
  for (const tool of entry.tools) {
    if (anyOn) enabled.delete(tool.name);
    else enabled.add(tool.name);
  }
  return [...enabled];
}

export function groupState(config: ToolConfigResponse, group: string): 'all' | 'some' | 'none' {
  const entry = config.groups.find((g) => g.group === group);
  if (!entry || entry.tools.length === 0) return 'none';
  const on = entry.tools.filter((t) => config.enabled_tools.includes(t.name)).length;
  if (on === 0) return 'none';
  return on === entry.tools.length ? 'all' : 'some';
}
