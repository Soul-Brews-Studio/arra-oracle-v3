import fs from 'fs';
import path from 'path';
import { ORACLE_DATA_DIR } from '../config.ts';

/**
 * Where tool configuration is read from, and — critically — where the settings
 * API writes it. Before #2822 the writer (`.arra/config.json`) and the reader
 * (`arra.config.json` / `$ORACLE_DATA_DIR/config.json`) used different
 * filenames, so every save through the UI was a silent no-op. One resolver now
 * answers both questions so they can never drift apart again.
 */
export interface ToolConfigSource {
  /** Absolute path the loader reads — and the settings API writes. */
  path: string;
  /** Human-readable label used in logs. */
  label: string;
  /** True when the file exists AND carries a key the loader accepts. */
  found: boolean;
}

export function readJsonSafe(filePath: string): Record<string, any> | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

export function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Keys that make a JSON file count as tool configuration. A file missing all of
 * them is skipped, and resolution falls through to the next tier.
 *
 * NOTE: `allowed_tools` is deliberately NOT here. It never was, which is why the
 * pre-#2822 settings API — which persisted exactly that key — had no effect.
 */
export function hasToolConfig(raw: Record<string, any>): boolean {
  return Array.isArray(raw.plugins)
    || isRecord(raw.tools)
    || Array.isArray(raw.disabled_tools)
    || Array.isArray(raw.enabled_tools)
    || typeof raw.mcp === 'boolean';
}

function hasPluginManifest(raw: Record<string, any>): boolean {
  return Array.isArray(raw.plugins);
}

interface SourceCandidate extends Omit<ToolConfigSource, 'found'> {
  accept: (raw: Record<string, any>) => boolean;
}

/**
 * FIRST MATCH WINS. A repo-root file shadows the global one entirely — the tiers
 * are not merged. Keep this list and the watcher in `tool-groups-watch.ts` in
 * sync; both must observe the same files.
 */
export function configSources(root: string, dataDir: string = ORACLE_DATA_DIR): SourceCandidate[] {
  return [
    { path: path.join(root, 'arra.config.json'), label: 'arra.config.json from repo root', accept: hasToolConfig },
    { path: path.join(root, 'plugins.json'), label: 'plugins.json from repo root', accept: hasPluginManifest },
    { path: path.join(dataDir, 'config.json'), label: `${dataDir}/config.json`, accept: hasToolConfig },
    { path: path.join(dataDir, 'plugins.json'), label: `${dataDir}/plugins.json`, accept: hasPluginManifest },
  ];
}

/** Tier used when no config file exists yet — the settings API creates this one. */
function writeTarget(root: string, dataDir?: string): SourceCandidate {
  return configSources(root, dataDir)[2]!;
}

export function resolveConfigSourceWithRaw(root: string, dataDir?: string): { source: ToolConfigSource; raw: Record<string, any> | null } {
  for (const candidate of configSources(root, dataDir)) {
    const raw = readJsonSafe(candidate.path);
    if (!raw || !candidate.accept(raw)) continue;
    return { source: { path: candidate.path, label: candidate.label, found: true }, raw };
  }
  const fallback = writeTarget(root);
  return { source: { path: fallback.path, label: fallback.label, found: false }, raw: null };
}

/**
 * The file the loader will read next. When nothing exists yet this returns the
 * global `$ORACLE_DATA_DIR/config.json` — the file the settings API should
 * create — so a fresh install writes somewhere the loader already looks.
 */
export function resolveToolConfigSource(repoRoot?: string): ToolConfigSource {
  const root = repoRoot || process.env.ORACLE_REPO_ROOT || process.cwd();
  return resolveConfigSourceWithRaw(root).source;
}

/**
 * Parse a comma-separated env tool list. Returns null when unset or empty so an
 * exported-but-blank variable never wipes the tool surface.
 */
export function envToolList(name: string): string[] | null {
  const raw = process.env[name];
  if (typeof raw !== 'string') return null;
  const items = raw.split(',').map((entry) => entry.trim()).filter(Boolean);
  return items.length ? items : null;
}
