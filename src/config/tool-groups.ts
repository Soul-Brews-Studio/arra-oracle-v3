/**
 * Tool Group Configuration
 *
 * Controls which tool groups are registered at startup.
 * Config sources (in priority order):
 *   1. arra.config.json in repo root (ORACLE_REPO_ROOT or cwd)
 *   2. ORACLE_DATA_DIR/config.json (global, see const.ts)
 *   3. Defaults: all groups enabled
 */

import fs from 'fs';
import path from 'path';
import { ORACLE_DATA_DIR } from '../config.ts';

export const TOOL_GROUPS = {
  search: ['muninn_search', 'muninn_read', 'muninn_list', 'muninn_concepts'],
  knowledge: ['muninn_learn', 'muninn_stats', 'muninn_supersede'],
  session: ['muninn_handoff', 'muninn_inbox'],
  forum: ['muninn_thread', 'muninn_threads', 'muninn_thread_read', 'muninn_thread_update'],
  trace: ['muninn_trace', 'muninn_trace_list', 'muninn_trace_get', 'muninn_trace_link', 'muninn_trace_unlink', 'muninn_trace_chain'],
} as const;

export type ToolGroupName = keyof typeof TOOL_GROUPS;

export type ToolGroupConfig = Record<ToolGroupName, boolean>;

const DEFAULT_CONFIG: ToolGroupConfig = {
  search: true,
  knowledge: true,
  session: true,
  forum: true,
  trace: true,
};

function readJsonSafe(filePath: string): Record<string, any> | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

export function loadToolGroupConfig(repoRoot?: string): ToolGroupConfig {
  const root = repoRoot || process.env.ORACLE_REPO_ROOT || process.cwd();

  // Priority 1: repo-local arra.config.json
  const localConfig = readJsonSafe(path.join(root, 'arra.config.json'));
  if (localConfig?.tools) {
    console.error('[ToolGroups] Using arra.config.json from repo root');
    return { ...DEFAULT_CONFIG, ...localConfig.tools };
  }

  // Priority 2: global config.json in data dir
  const globalConfig = readJsonSafe(path.join(ORACLE_DATA_DIR, 'config.json'));
  if (globalConfig?.tools) {
    console.error(`[ToolGroups] Using ${ORACLE_DATA_DIR}/config.json`);
    return { ...DEFAULT_CONFIG, ...globalConfig.tools };
  }

  // Priority 3: all enabled
  return { ...DEFAULT_CONFIG };
}

/** Returns a Set of tool names that should be disabled based on config */
export function getDisabledTools(config: ToolGroupConfig): Set<string> {
  const disabled = new Set<string>();
  for (const [group, tools] of Object.entries(TOOL_GROUPS)) {
    if (!config[group as ToolGroupName]) {
      for (const tool of tools) {
        disabled.add(tool);
      }
    }
  }
  return disabled;
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

  for (const target of [localPath, globalPath]) {
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
