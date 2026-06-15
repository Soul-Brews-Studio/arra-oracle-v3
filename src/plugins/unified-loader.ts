import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  normalizeUnifiedPluginManifest,
  type NormalizedUnifiedPluginManifest,
} from './unified-manifest.ts';

export interface LoadedUnifiedPluginManifest {
  manifest: NormalizedUnifiedPluginManifest;
  dir: string;
  entryPath: string;
  manifestPath: string;
}

export interface DiscoverUnifiedPluginOptions {
  dirs?: string[];
  warn?: (message: string) => void;
}

function envDirs(): string[] {
  return [
    process.env.ORACLE_UNIFIED_PLUGIN_DIR,
    process.env.ARRA_UNIFIED_PLUGIN_DIR,
    process.env.ORACLE_PLUGIN_HOME,
  ]
    .flatMap((raw) => raw?.split(':') ?? [])
    .map((dir) => dir.trim())
    .filter(Boolean);
}

function defaultDirs(): string[] {
  return [
    ...envDirs(),
    join(homedir(), '.neo-arra', 'plugins'),
    join(homedir(), '.oracle', 'plugins'),
  ];
}

function pluginDirs(baseDir: string): string[] {
  if (!existsSync(baseDir)) return [];
  let stat;
  try {
    stat = statSync(baseDir);
  } catch {
    return [];
  }
  if (!stat.isDirectory()) return [];
  if (existsSync(join(baseDir, 'plugin.json'))) return [baseDir];
  try {
    return readdirSync(baseDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(baseDir, entry.name));
  } catch {
    return [];
  }
}

function loadManifestDir(
  dir: string,
  warn: (message: string) => void,
): LoadedUnifiedPluginManifest | null {
  const manifestPath = join(dir, 'plugin.json');
  if (!existsSync(manifestPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (!raw || typeof raw !== 'object' || typeof raw.entry !== 'string') return null;
    const manifest = normalizeUnifiedPluginManifest(raw);
    if (manifest.enabled === false) return null;
    if (!manifest.apiRoutes.length && !manifest.menu.length) return null;
    return {
      manifest,
      dir,
      entryPath: resolve(dir, manifest.entry),
      manifestPath,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warn(`[unified-plugin] skipped ${manifestPath}: ${message}`);
    return null;
  }
}

export function discoverUnifiedPluginManifests(
  options: DiscoverUnifiedPluginOptions = {},
): LoadedUnifiedPluginManifest[] {
  const warn = options.warn ?? console.warn;
  const seen = new Set<string>();
  const loaded: LoadedUnifiedPluginManifest[] = [];
  for (const baseDir of options.dirs ?? defaultDirs()) {
    for (const dir of pluginDirs(baseDir)) {
      const plugin = loadManifestDir(dir, warn);
      if (!plugin || seen.has(plugin.manifest.name)) continue;
      seen.add(plugin.manifest.name);
      loaded.push(plugin);
    }
  }
  return loaded;
}
