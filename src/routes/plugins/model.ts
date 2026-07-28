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
import type { MenuItem as NavMenuItem } from '../menu/model.ts';

export const PLUGIN_DIR = join(homedir(), '.oracle', 'plugins');

export function getPluginDir(): string {
  const override = process.env.ORACLE_PLUGIN_DIR?.trim();
  return override || PLUGIN_DIR;
}

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
  menu?: PluginMenu;
};

export type PluginMenuItem = NavMenuItem & {
  sourceName: string;
};

export type MenuItem = PluginMenuItem;

export const pluginNameParams = t.Object({ name: t.String() });

function parseMenu(raw: unknown): PluginMenu | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const m = raw as Record<string, unknown>;
  if (typeof m.label !== 'string' || !m.label) return undefined;
  const group =
    m.group === 'main' || m.group === 'tools' || m.group === 'hidden' ? m.group : undefined;
  const order = typeof m.order === 'number' ? m.order : undefined;
  const icon = typeof m.icon === 'string' ? m.icon : undefined;
  const path = typeof m.path === 'string' ? m.path : undefined;
  return { label: m.label, group, order, icon, path };
}

export function readNestedPlugin(
  dir: string,
  entryName: string,
): PluginEntry | null {
  const manifestPath = join(dir, 'plugin.json');
  if (!existsSync(manifestPath)) return null;
  let manifest: {
    name?: string;
    version?: string;
    description?: string;
    wasm?: string;
    menu?: unknown;
  };
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return null;
  }
  const wasmName = manifest.wasm;
  if (!wasmName || typeof wasmName !== 'string') return null;

  // Try manifest path as-is, then fall back to basename (plugins copied flat
  // by `arra-cli plugin install` keep the source path in manifest.wasm).
  let wasmPath = join(dir, wasmName);
  let resolvedName = wasmName;
  if (!existsSync(wasmPath)) {
    const base = basename(wasmName);
    const basePath = join(dir, base);
    if (!existsSync(basePath)) return null;
    wasmPath = basePath;
    resolvedName = base;
  }
  const st = statSync(wasmPath);
  return {
    name: typeof manifest.name === 'string' && manifest.name ? manifest.name : entryName,
    file: resolvedName,
    size: st.size,
    modified: st.mtime.toISOString(),
    version: typeof manifest.version === 'string' ? manifest.version : undefined,
    description: typeof manifest.description === 'string' ? manifest.description : undefined,
    menu: parseMenu(manifest.menu),
  };
}

export function readFlatPlugin(file: string, dir = getPluginDir()): PluginEntry {
  const st = statSync(join(dir, file));
  return {
    name: file.replace(/\.wasm$/, ''),
    file,
    size: st.size,
    modified: st.mtime.toISOString(),
  };
}

export function resolveWasmPath(name: string, dir = getPluginDir()): string | null {
  const nestedManifest = join(dir, name, 'plugin.json');
  if (existsSync(nestedManifest)) {
    try {
      const manifest = JSON.parse(readFileSync(nestedManifest, 'utf8'));
      if (manifest.wasm && typeof manifest.wasm === 'string') {
        const full = join(dir, name, manifest.wasm);
        if (existsSync(full)) return full;
        const base = join(dir, name, basename(manifest.wasm));
        if (existsSync(base)) return base;
      }
    } catch {
      // fall through to flat
    }
  }
  const flat = join(dir, `${name}.wasm`);
  if (existsSync(flat)) return flat;
  return null;
}

export function scanPlugins(dir = getPluginDir()): { plugins: PluginEntry[]; dir: string } {
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

export function getPluginMenuItems(dir = getPluginDir()): PluginMenuItem[] {
  const { plugins } = scanPlugins(dir);
  const items: PluginMenuItem[] = [];
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
