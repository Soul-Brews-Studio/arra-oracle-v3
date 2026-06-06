/**
 * Tool Group Configuration
 *
 * Controls which tool groups are registered at startup.
 * Config sources (in priority order):
 *   1. ORACLE_ENABLED_TOOLS / ORACLE_DISABLED_TOOLS env lists
 *   2. arra.config.json or .arra/config.json in repo root (ORACLE_REPO_ROOT or cwd)
 *   3. ORACLE_DATA_DIR/config.json (global, see const.ts)
 *   4. Defaults: all groups enabled
 */

import fs from 'fs';
import path from 'path';
import { ORACLE_DATA_DIR } from '../config.ts';

export const META_TOOL_NAME = '____IMPORTANT';

export const TOOL_GROUPS = {
  search: ['oracle_search', 'oracle_read', 'oracle_list', 'oracle_concepts'],
  knowledge: ['oracle_learn', 'oracle_stats', 'oracle_supersede'],
  session: ['oracle_handoff', 'oracle_inbox'],
  forum: ['oracle_thread', 'oracle_threads', 'oracle_thread_read', 'oracle_thread_update'],
  trace: ['oracle_trace', 'oracle_trace_list', 'oracle_trace_get', 'oracle_trace_link', 'oracle_trace_unlink', 'oracle_trace_chain'],
  // #972: standalone tools that don't fit any other group. Handlers ALSO power
  // HTTP routes (/api/reflect, /api/verify) — same code path. NOTE: schedule_*
  // handlers exist + power /api/schedule/* but are intentionally NOT exposed
  // as MCP tools (per user direction — keep schedule HTTP-only).
  standalone: ['oracle_reflect', 'oracle_verify'],
} as const;

export type ToolGroupName = keyof typeof TOOL_GROUPS;

/**
 * Resolved tool-group config used at request time.
 * - The named group booleans toggle whole groups.
 * - `disabled_tools` adds per-tool blocks on top of the group-disabled set.
 * - `enabled_tools` is a whitelist override — brings back a single tool from
 *   a disabled group OR cancels a per-tool block. Whitelist wins last.
 */
export type ToolGroupConfig = Record<ToolGroupName, boolean> & {
  disabled_tools?: string[];
  /** Legacy override: re-enables listed tools after group/disabled_tools processing. */
  enabled_tools?: string[];
  /** Strict allow-list: when present, every other MCP tool is hidden from tools/list and calls. */
  allowed_tools?: string[];
};

const DEFAULT_CONFIG: ToolGroupConfig = {
  search: true,
  knowledge: true,
  session: true,
  forum: true,
  trace: true,
  standalone: true,
};

/** All registered tool names — for validating disabled_tools / enabled_tools entries. */
const ALIAS_PREFIXES = ['arra_', 'muninn_'] as const;

export function normalizeToolName(name: string): string {
  for (const p of ALIAS_PREFIXES) {
    if (name.startsWith(p)) return 'oracle_' + name.slice(p.length);
  }
  return name;
}

const ALL_TOOL_NAMES: ReadonlySet<string> = new Set([
  META_TOOL_NAME,
  ...(Object.values(TOOL_GROUPS).flat() as string[]),
]);

function parseToolList(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function normalizeToolList(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw
    .filter((t: unknown): t is string => typeof t === 'string')
    .map(normalizeToolName);
}

function readJsonSafe(filePath: string): Record<string, any> | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function hasToolConfig(raw: Record<string, any>): boolean {
  return Boolean(
    raw.tools ||
      raw.disabled_tools ||
      raw.enabled_tools ||
      raw.allowed_tools ||
      raw.only_tools ||
      raw.mcp_disabled_tools ||
      raw.mcp_enabled_tools ||
      raw.mcp_allowed_tools
  );
}

function mergeRaw(raw: Record<string, any>): ToolGroupConfig {
  const merged: ToolGroupConfig = { ...DEFAULT_CONFIG, ...raw.tools };
  const disabled = normalizeToolList(raw.disabled_tools ?? raw.mcp_disabled_tools);
  if (disabled) merged.disabled_tools = disabled;
  const enabled = normalizeToolList(raw.enabled_tools ?? raw.mcp_enabled_tools);
  if (enabled) merged.enabled_tools = enabled;
  const allowed = normalizeToolList(raw.allowed_tools ?? raw.only_tools ?? raw.mcp_allowed_tools);
  if (allowed) merged.allowed_tools = allowed;
  return merged;
}

export function loadToolGroupConfig(repoRoot?: string): ToolGroupConfig {
  const root = repoRoot || process.env.ORACLE_REPO_ROOT || process.cwd();

  const envAllowed = parseToolList(process.env.ORACLE_ENABLED_TOOLS).map(normalizeToolName);
  const envDisabled = parseToolList(process.env.ORACLE_DISABLED_TOOLS).map(normalizeToolName);
  if (envAllowed.length || envDisabled.length) {
    console.error('[ToolGroups] Using ORACLE_ENABLED_TOOLS / ORACLE_DISABLED_TOOLS');
    return {
      ...DEFAULT_CONFIG,
      ...(envAllowed.length ? { allowed_tools: envAllowed } : {}),
      ...(envDisabled.length ? { disabled_tools: envDisabled } : {}),
    };
  }

  // Priority 1: repo-local arra.config.json or .arra/config.json
  for (const [label, filePath] of [
    ['arra.config.json from repo root', path.join(root, 'arra.config.json')],
    ['.arra/config.json from repo root', path.join(root, '.arra', 'config.json')],
  ] as const) {
    const localConfig = readJsonSafe(filePath);
    if (localConfig && hasToolConfig(localConfig)) {
      console.error(`[ToolGroups] Using ${label}`);
      return mergeRaw(localConfig);
    }
  }

  // Priority 2: global config.json in data dir
  const globalConfig = readJsonSafe(path.join(ORACLE_DATA_DIR, 'config.json'));
  if (globalConfig && hasToolConfig(globalConfig)) {
    console.error(`[ToolGroups] Using ${ORACLE_DATA_DIR}/config.json`);
    return mergeRaw(globalConfig);
  }

  // Priority 3: all enabled
  return { ...DEFAULT_CONFIG };
}

/**
 * Returns a Set of tool names that should be disabled based on config.
 *
 * Resolution order:
 *   1. group-disabled (any tool whose group has `<group>: false`)
 *   2. ∪ per-tool blocklist (`disabled_tools`)
 *   3. \ per-tool whitelist (`enabled_tools`) — wins last
 *
 * Unknown tool names in `disabled_tools` / `enabled_tools` are ignored with
 * a warning — typos shouldn't crash the server or silently disable real tools.
 */
export function getDisabledTools(config: ToolGroupConfig): Set<string> {
  const disabled = new Set<string>();
  for (const [group, tools] of Object.entries(TOOL_GROUPS)) {
    if (!config[group as ToolGroupName]) {
      for (const tool of tools) {
        disabled.add(tool);
      }
    }
  }
  for (const raw of config.disabled_tools ?? []) {
    const t = normalizeToolName(raw);
    if (!ALL_TOOL_NAMES.has(t)) {
      console.error(`[ToolGroups] disabled_tools: unknown tool "${t}" — ignored`);
      continue;
    }
    disabled.add(t);
  }
  for (const raw of config.enabled_tools ?? []) {
    const t = normalizeToolName(raw);
    if (!ALL_TOOL_NAMES.has(t)) {
      console.error(`[ToolGroups] enabled_tools: unknown tool "${t}" — ignored`);
      continue;
    }
    disabled.delete(t);
  }
  if (config.allowed_tools?.length) {
    const allowed = new Set<string>();
    for (const raw of config.allowed_tools) {
      const t = normalizeToolName(raw);
      if (!ALL_TOOL_NAMES.has(t)) {
        console.error(`[ToolGroups] allowed_tools: unknown tool "${raw}" — ignored`);
        continue;
      }
      allowed.add(t);
    }
    for (const t of ALL_TOOL_NAMES) {
      if (!allowed.has(t)) disabled.add(t);
    }
  }
  return disabled;
}

export function getEnabledToolNames(config: ToolGroupConfig): Set<string> {
  const disabled = getDisabledTools(config);
  return new Set([...ALL_TOOL_NAMES].filter((t) => !disabled.has(t)));
}

/**
 * Watch tool group config files and invoke onChange when content changes.
 * Watches BOTH the repo-local arra.config.json and the global data-dir config.json,
 * so a change to either reloads via the same priority order as loadToolGroupConfig.
 *
 * - Debounces fs.watch events (200ms) — editors fire multiple events per save.
 * - Skips no-op reloads (compares against last loaded config).
 * - Swallows JSON parse errors — keeps the last good config until the file is valid again.
 * - Returns a stop function to close the watchers (call on shutdown).
 */
export function watchToolGroupConfig(
  onChange: (next: ToolGroupConfig) => void,
  repoRoot?: string,
): () => void {
  const root = repoRoot || process.env.ORACLE_REPO_ROOT || process.cwd();
  const localPath = path.join(root, 'arra.config.json');
  const dotArraPath = path.join(root, '.arra', 'config.json');
  const globalPath = path.join(ORACLE_DATA_DIR, 'config.json');
  const watchers: fs.FSWatcher[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = JSON.stringify(loadToolGroupConfig(root));

  const tick = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const next = loadToolGroupConfig(root);
      const serialized = JSON.stringify(next);
      if (serialized === last) return;
      last = serialized;
      console.error('[ToolGroups] Config changed — reloading');
      onChange(next);
    }, 200);
  };

  for (const target of [localPath, dotArraPath, globalPath]) {
    try {
      // Watch the file directly. fs.watch on a missing file throws on Linux
      // and silently fails on macOS, so probe with existsSync first.
      if (fs.existsSync(target)) {
        watchers.push(fs.watch(target, { persistent: false }, tick));
      } else {
        // Watch the directory so we catch creation. Ignored if dir is missing.
        const dir = path.dirname(target);
        if (fs.existsSync(dir)) {
          const base = path.basename(target);
          watchers.push(
            fs.watch(dir, { persistent: false }, (_event, filename) => {
              if (filename === base) tick();
            }),
          );
        }
      }
    } catch {
      // fs.watch can fail on platforms without inotify — keep going.
    }
  }

  return () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    for (const w of watchers) {
      try {
        w.close();
      } catch {}
    }
  };
}
