import fs from 'fs';
import path from 'path';
import { ORACLE_DATA_DIR } from '../config.ts';

export const TOOL_GROUPS = {
  search: ['oracle_search', 'oracle_read', 'oracle_list', 'oracle_concepts'],
  knowledge: ['oracle_learn', 'oracle_stats', 'oracle_supersede', 'oracle_research_note'],
  session: ['oracle_handoff', 'oracle_inbox'],
  forum: ['oracle_thread', 'oracle_threads', 'oracle_thread_read', 'oracle_thread_update'],
  oracle: ['oracle_profile'],
  trace: ['oracle_trace', 'oracle_trace_list', 'oracle_trace_get', 'oracle_trace_link', 'oracle_trace_unlink', 'oracle_trace_chain', 'oracle_trace_distill'],
  standalone: ['oracle_reflect', 'oracle_verify'],
} as const;

export type ToolGroupName = keyof typeof TOOL_GROUPS;
export type PluginTier = 'core' | 'standard' | 'extra';
export interface PluginManifestEntry { name: string; enabled?: boolean; tier?: PluginTier; weight?: number; }
export interface ToolPlugin { name: string; tier: PluginTier; weight: number; tools: readonly string[]; }

export const TOOL_PLUGINS: Record<string, ToolPlugin> = {
  guide: { name: 'guide', tier: 'core', weight: 0, tools: ['____IMPORTANT'] },
  search: { name: 'search', tier: 'core', weight: 10, tools: TOOL_GROUPS.search },
  knowledge: { name: 'knowledge', tier: 'core', weight: 20, tools: TOOL_GROUPS.knowledge },
  oracle: { name: 'oracle', tier: 'standard', weight: 25, tools: TOOL_GROUPS.oracle },
  session: { name: 'session', tier: 'standard', weight: 30, tools: TOOL_GROUPS.session },
  forum: { name: 'forum', tier: 'standard', weight: 40, tools: TOOL_GROUPS.forum },
  trace: { name: 'trace', tier: 'standard', weight: 50, tools: ['oracle_trace', 'oracle_trace_distill'] },
  dig: {
    name: 'dig', tier: 'standard', weight: 60,
    tools: ['oracle_trace_list', 'oracle_trace_get', 'oracle_trace_link', 'oracle_trace_unlink', 'oracle_trace_chain'],
  },
  standalone: { name: 'standalone', tier: 'extra', weight: 70, tools: TOOL_GROUPS.standalone },
};

export type ToolGroupConfig = Record<ToolGroupName, boolean> & {
  plugins?: PluginManifestEntry[];
  disabled_tools?: string[];
  enabled_tools?: string[];
};

const DEFAULT_CONFIG: ToolGroupConfig = {
  search: true,
  knowledge: true,
  session: true,
  forum: true,
  oracle: true,
  trace: true,
  standalone: true,
};

const ALL_TOOL_NAMES: ReadonlySet<string> = new Set(
  [...Object.values(TOOL_PLUGINS).flatMap((p) => p.tools), ...Object.values(TOOL_GROUPS).flat()] as string[],
);
const DEFAULT_TOOL_ORDER = Object.values(TOOL_PLUGINS)
  .sort((a, b) => a.weight - b.weight || a.name.localeCompare(b.name))
  .flatMap((p) => p.tools);

export function normalizeToolName(name: string): string {
  if (name.startsWith('arra_')) return `oracle_${name.slice('arra_'.length)}`;
  if (name.startsWith('muninn_')) return `oracle_${name.slice('muninn_'.length)}`;
  return name;
}

function readJsonSafe(filePath: string): Record<string, any> | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function mergeRaw(raw: Record<string, any>): ToolGroupConfig {
  const merged: ToolGroupConfig = { ...DEFAULT_CONFIG };
  if (isRecord(raw.tools)) {
    for (const group of Object.keys(TOOL_GROUPS) as ToolGroupName[]) {
      if (typeof raw.tools[group] === 'boolean') merged[group] = raw.tools[group];
    }
  }
  if (Array.isArray(raw.plugins)) {
    merged.plugins = raw.plugins.map(normalizePluginEntry).filter((p): p is PluginManifestEntry => !!p);
  }
  if (Array.isArray(raw.disabled_tools)) merged.disabled_tools = raw.disabled_tools.filter((t: unknown) => typeof t === 'string').map(normalizeToolName);
  if (Array.isArray(raw.enabled_tools)) merged.enabled_tools = raw.enabled_tools.filter((t: unknown) => typeof t === 'string').map(normalizeToolName);
  return merged;
}

function normalizePluginEntry(entry: unknown): PluginManifestEntry | null {
  if (!isRecord(entry) || typeof entry.name !== 'string' || !entry.name.trim()) return null;
  return {
    name: entry.name.trim(),
    ...(typeof entry.enabled === 'boolean' && { enabled: entry.enabled }),
    ...(isPluginTier(entry.tier) && { tier: entry.tier }),
    ...(typeof entry.weight === 'number' && Number.isFinite(entry.weight) && { weight: entry.weight }),
  };
}

function isPluginTier(value: unknown): value is PluginTier {
  return value === 'core' || value === 'standard' || value === 'extra';
}

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function loadToolGroupConfig(repoRoot?: string): ToolGroupConfig {
  const root = repoRoot || process.env.ORACLE_REPO_ROOT || process.cwd();
  const localConfig = readJsonSafe(path.join(root, 'arra.config.json'));
  if (localConfig && (localConfig.plugins || localConfig.tools || localConfig.disabled_tools || localConfig.enabled_tools)) {
    console.error('[ToolGroups] Using arra.config.json from repo root');
    return mergeRaw(localConfig);
  }
  const localPluginManifest = readJsonSafe(path.join(root, 'plugins.json'));
  if (localPluginManifest && Array.isArray(localPluginManifest.plugins)) {
    console.error('[ToolGroups] Using plugins.json from repo root');
    return mergeRaw(localPluginManifest);
  }
  const globalConfig = readJsonSafe(path.join(ORACLE_DATA_DIR, 'config.json'));
  if (globalConfig && (globalConfig.plugins || globalConfig.tools || globalConfig.disabled_tools || globalConfig.enabled_tools)) {
    console.error(`[ToolGroups] Using ${ORACLE_DATA_DIR}/config.json`);
    return mergeRaw(globalConfig);
  }
  const globalPluginManifest = readJsonSafe(path.join(ORACLE_DATA_DIR, 'plugins.json'));
  if (globalPluginManifest && Array.isArray(globalPluginManifest.plugins)) {
    console.error(`[ToolGroups] Using ${ORACLE_DATA_DIR}/plugins.json`);
    return mergeRaw(globalPluginManifest);
  }
  return { ...DEFAULT_CONFIG };
}

export function getDisabledTools(config: ToolGroupConfig): Set<string> {
  const enabled = new Set(getEnabledToolNames(config));
  const disabled = new Set<string>();
  for (const tool of ALL_TOOL_NAMES) if (!enabled.has(tool)) disabled.add(tool);
  for (const [group, tools] of Object.entries(TOOL_GROUPS)) {
    if (!config[group as ToolGroupName]) for (const tool of tools) disabled.add(tool);
  }
  for (const t of config.disabled_tools ?? []) {
    const tool = normalizeToolName(t);
    if (!ALL_TOOL_NAMES.has(tool)) { console.error(`[ToolGroups] disabled_tools: unknown tool "${t}" — ignored`); continue; }
    disabled.add(tool);
  }
  for (const t of config.enabled_tools ?? []) {
    const tool = normalizeToolName(t);
    if (!ALL_TOOL_NAMES.has(tool)) { console.error(`[ToolGroups] enabled_tools: unknown tool "${t}" — ignored`); continue; }
    disabled.delete(tool);
  }
  return disabled;
}

export function getEnabledToolNames(config: ToolGroupConfig): string[] {
  const ordered = config.plugins ? pluginOrderedTools(config.plugins) : DEFAULT_TOOL_ORDER;
  const seen = new Set<string>();
  const enabled = ordered.filter((tool) => !seen.has(tool) && seen.add(tool) && ALL_TOOL_NAMES.has(tool));
  for (const [group, tools] of Object.entries(TOOL_GROUPS)) {
    if (!config[group as ToolGroupName]) for (const tool of tools) seen.delete(tool);
  }
  for (const t of config.disabled_tools ?? []) if (ALL_TOOL_NAMES.has(normalizeToolName(t))) seen.delete(normalizeToolName(t));
  for (const t of config.enabled_tools ?? []) if (ALL_TOOL_NAMES.has(normalizeToolName(t))) seen.add(normalizeToolName(t));
  return [
    ...enabled.filter((tool) => seen.has(tool)),
    ...(config.enabled_tools ?? []).map(normalizeToolName).filter((tool) => seen.has(tool) && !enabled.includes(tool)),
  ];
}

function pluginOrderedTools(entries: PluginManifestEntry[]): readonly string[] {
  return entries
    .map((entry) => {
      const plugin = TOOL_PLUGINS[entry.name];
      if (!plugin) { console.error(`[ToolGroups] plugins: unknown plugin "${entry.name}" — ignored`); return null; }
      return { ...plugin, enabled: entry.enabled !== false, tier: entry.tier ?? plugin.tier, weight: entry.weight ?? plugin.weight };
    })
    .filter((p): p is ToolPlugin & { enabled: boolean } => !!p && p.enabled)
    .sort((a, b) => a.weight - b.weight || a.name.localeCompare(b.name))
    .flatMap((p) => p.tools);
}
