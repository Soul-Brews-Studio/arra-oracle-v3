/** Canonical plugin scanner shared between /api/plugins and
 * /api/plugins/:name. Two layouts side-by-side:
 *   1. Nested: ~/.oracle/plugins/<name>/plugin.json + <wasm-from-manifest>
 *   2. Flat:   ~/.oracle/plugins/<name>.wasm
 *
 * Logic is identical to src/routes/plugins.ts (the Hono twin, scheduled for
 * removal once the Elysia migration wires up). During transition both exist. */
import { t, type Static } from 'elysia';
import { readdirSync, statSync, readFileSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import {
  normalizeUnifiedPluginManifest,
  publicUnifiedServerManifest,
  type PublicUnifiedServerManifest,
} from '../../plugins/unified-manifest.ts';
import { resolveContainedPluginEntry } from '../../plugins/path-containment.ts';

export const PLUGIN_DIR = join(homedir(), '.oracle', 'plugins');

export const PluginMenuSchema = t.Object({
  label: t.String(),
  group: t.Optional(t.Union([t.Literal('main'), t.Literal('tools'), t.Literal('hidden')])),
  order: t.Optional(t.Number()),
  icon: t.Optional(t.String()),
  path: t.Optional(t.String()),
});

export type PluginMenu = Static<typeof PluginMenuSchema>;

export type PluginEntry = {
  name: string;
  file: string;
  size: number;
  modified: string;
  version?: string;
  description?: string;
  enabled?: boolean;
  menu?: PluginMenu;
  server?: PublicUnifiedServerManifest;
};

export type MenuItem = {
  label: string;
  path: string;
  group: 'main' | 'tools' | 'hidden';
  order: number;
  icon?: string;
  source: 'plugin';
  sourceName: string;
};

export const pluginNameParams = t.Object({ name: t.String() });

type RawPluginManifest = {
  name?: string;
  version?: string;
  description?: string;
  enabled?: boolean;
  wasm?: string;
  menu?: unknown;
  server?: unknown;
};

export function sanitizePluginName(name: string): string {
  return name.replace(/[^\w.-]/g, '').replace(/\.wasm$/, '');
}

export function currentPluginDir(): string {
  return process.env.ORACLE_PLUGIN_DIR || PLUGIN_DIR;
}

export function readPluginManifest(dir: string): RawPluginManifest | null {
  try {
    return JSON.parse(readFileSync(join(dir, 'plugin.json'), 'utf8'));
  } catch {
    return null;
  }
}

function parseMenu(raw: unknown): PluginMenu | undefined {
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  if (!candidate || typeof candidate !== 'object') return undefined;
  const m = candidate as Record<string, unknown>;
  if (typeof m.label !== 'string' || !m.label) return undefined;
  const group =
    m.group === 'main' || m.group === 'tools' || m.group === 'hidden' ? m.group : undefined;
  const order = typeof m.order === 'number' ? m.order : undefined;
  const icon = typeof m.icon === 'string' ? m.icon : undefined;
  const path = typeof m.path === 'string' ? m.path : undefined;
  return { label: m.label, group, order, icon, path };
}

function serverEntry(manifest: RawPluginManifest): PublicUnifiedServerManifest | undefined {
  if (!manifest.server) return undefined;
  try {
    return publicUnifiedServerManifest(normalizeUnifiedPluginManifest(manifest).server);
  } catch {
    return undefined;
  }
}

export function readNestedPlugin(
  dir: string,
  entryName: string,
): PluginEntry | null {
  const manifestPath = join(dir, 'plugin.json');
  if (!existsSync(manifestPath)) return null;
  const manifest = readPluginManifest(dir);
  if (!manifest) return null;

  const server = serverEntry(manifest);
  if (manifest.server && !server) return null;
  const base = {
    name: typeof manifest.name === 'string' && manifest.name ? manifest.name : entryName,
    version: typeof manifest.version === 'string' ? manifest.version : undefined,
    description: typeof manifest.description === 'string' ? manifest.description : undefined,
    enabled: manifest.enabled !== false,
    menu: parseMenu(manifest.menu),
    server,
  };
  const wasmName = manifest.wasm;
  if (!wasmName || typeof wasmName !== 'string') {
    if (!server) return null;
    const st = statSync(manifestPath);
    return { ...base, file: '', size: 0, modified: st.mtime.toISOString() };
  }

  // Try manifest path as-is, then fall back to basename (plugins copied flat
  // by `arra-cli plugin install` keep the source path in manifest.wasm).
  let wasmPath = containedPluginPath(dir, wasmName);
  let resolvedName = wasmName;
  if (!wasmPath || !existsSync(wasmPath)) {
    const baseName = basename(wasmName);
    const basePath = containedPluginPath(dir, baseName);
    if (!basePath) return null;
    if (!existsSync(basePath)) {
      if (!server) return null;
      const st = statSync(manifestPath);
      return { ...base, file: '', size: 0, modified: st.mtime.toISOString() };
    }
    wasmPath = basePath;
    resolvedName = baseName;
  }
  const st = statSync(wasmPath);
  return {
    ...base,
    file: resolvedName,
    size: st.size,
    modified: st.mtime.toISOString(),
  };
}

function containedPluginPath(dir: string, wasmName: string): string | null {
  try {
    return resolveContainedPluginEntry(dir, wasmName);
  } catch {
    return null;
  }
}

export function readFlatPlugin(file: string, dir = currentPluginDir()): PluginEntry {
  const st = statSync(join(dir, file));
  return {
    name: file.replace(/\.wasm$/, ''),
    file,
    size: st.size,
    modified: st.mtime.toISOString(),
    enabled: true,
  };
}

export function resolveWasmPath(name: string, dir = currentPluginDir()): string | null {
  const nestedManifest = join(dir, name, 'plugin.json');
  if (existsSync(nestedManifest)) {
    try {
      const manifest = JSON.parse(readFileSync(nestedManifest, 'utf8'));
      if (manifest.wasm && typeof manifest.wasm === 'string') {
        const pluginDir = join(dir, name);
        const full = containedPluginPath(pluginDir, manifest.wasm);
        if (full && existsSync(full)) return full;
        const base = containedPluginPath(pluginDir, basename(manifest.wasm));
        if (base && existsSync(base)) return base;
      }
    } catch {
      // fall through to flat
    }
  }
  const flat = join(dir, `${name}.wasm`);
  if (existsSync(flat)) return flat;
  return null;
}

export function scanPlugins(dir = currentPluginDir()): { plugins: PluginEntry[]; dir: string } {
  if (!existsSync(dir)) return { plugins: [], dir };
  const plugins: PluginEntry[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    let st;
    try {
      st = statSync(fullPath);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      const nested = readNestedPlugin(fullPath, entry);
      if (nested) plugins.push(nested);
    } else if (st.isFile() && entry.endsWith('.wasm')) {
      plugins.push(readFlatPlugin(entry, dir));
    }
  }
  return { plugins, dir };
}

export function getPluginMenuItems(): MenuItem[] {
  const { plugins } = scanPlugins();
  const items: MenuItem[] = [];
  for (const p of plugins) {
    if (!p.menu) continue;
    items.push({
      label: p.menu.label,
      path: p.menu.path ?? `/plugins/${p.name}`,
      group: p.menu.group ?? 'tools',
      order: p.menu.order ?? 999,
      icon: p.menu.icon,
      source: 'plugin',
      sourceName: p.name,
    });
  }
  return items;
}
