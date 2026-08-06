import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import frontend from './frontend.ts';
import { normalizeMenuPath } from './path.ts';
import type { MenuItem } from '../routes/menu/model.ts';

export type { MenuItem };

const MENU_GROUPS = ['main', 'tools', 'hidden', 'admin'] as const;
const MENU_SCOPES = ['main', 'sub', 'both'] as const;
type MenuScope = typeof MENU_SCOPES[number];

function normalizePath(value: string): string {
  return normalizeMenuPath(value);
}

function normalizeGroup(value: unknown): MenuItem['group'] {
  return MENU_GROUPS.includes(value as MenuItem['group'])
    ? value as MenuItem['group']
    : 'tools';
}

function normalizeOrder(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 999;
}

function normalizeSource(value: unknown): MenuItem['source'] {
  return value === 'api' || value === 'plugin' ? value : 'page';
}

function normalizeQuery(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const query: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    const cleanKey = key.trim();
    const cleanValue = typeof raw === 'string' ? raw.trim() : '';
    if (cleanKey && cleanValue) query[cleanKey] = cleanValue;
  }
  return Object.keys(query).length ? query : undefined;
}

function normalizeOptionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function setOptionalFields(item: MenuItem, raw: Record<string, unknown>): void {
  const icon = normalizeOptionalText(raw.icon);
  const parentId = normalizeOptionalText(raw.parentId);
  const studio = normalizeOptionalText(raw.studio);
  const sourceName = normalizeOptionalText(raw.sourceName);

  if (icon) item.icon = icon;
  if (parentId) item.parentId = parentId;
  else if (raw.parentId === null) item.parentId = null;
  if (studio) item.studio = studio;
  else if (raw.studio === null) item.studio = null;
  if (raw.access === 'public' || raw.access === 'auth') item.access = raw.access;
  if (sourceName) item.sourceName = sourceName;
  if (typeof raw.hidden === 'boolean') item.hidden = raw.hidden;
  if (typeof raw.added === 'boolean') item.added = raw.added;
  if (typeof raw.scope === 'string' && MENU_SCOPES.includes(raw.scope as MenuScope)) {
    item.scope = raw.scope as MenuScope;
  }
  const query = normalizeQuery(raw.query);
  if (query) item.query = query;
}

function normalizeLoadedItem(value: unknown): MenuItem | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.path !== 'string' || typeof raw.label !== 'string') return null;
  const path = normalizePath(raw.path);
  const label = raw.label.trim();
  if (!path || !label) return null;
  const item: MenuItem = {
    path,
    label,
    group: normalizeGroup(raw.group),
    order: normalizeOrder(raw.order),
    source: normalizeSource(raw.source),
  };
  setOptionalFields(item, raw);
  return item;
}

export async function loadMenuItemsFromDir(dir: string): Promise<MenuItem[]> {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    console.warn(
      `[menu] ORACLE_MENU_DIR=${dir} does not exist; falling back to bundled defaults`,
    );
    return [...frontend];
  }

  const entries = readdirSync(dir)
    .filter((name) => {
      const ext = extname(name).toLowerCase();
      return ext === '.ts' || ext === '.json';
    })
    .sort();

  const byPath = new Map<string, MenuItem>();
  for (const name of entries) {
    const full = join(dir, name);
    const ext = extname(name).toLowerCase();
    let loaded: unknown;
    try {
      if (ext === '.json') {
        loaded = JSON.parse(readFileSync(full, 'utf-8'));
      } else {
        const mod = await import(resolve(full));
        loaded = (mod as { default?: unknown }).default;
      }
    } catch (err) {
      console.warn(`[menu] failed to load ${full}:`, err);
      continue;
    }
    if (!Array.isArray(loaded)) {
      console.warn(`[menu] ${full} did not export an array; skipping`);
      continue;
    }
    for (const raw of loaded) {
      const item = normalizeLoadedItem(raw);
      if (!item) continue;
      byPath.set(item.path, item);
    }
  }

  return Array.from(byPath.values());
}

let cached: MenuItem[] = [...frontend];
const envDir = process.env.ORACLE_MENU_DIR;
if (envDir) {
  try {
    cached = await loadMenuItemsFromDir(envDir);
  } catch (err) {
    console.warn(`[menu] failed to load ORACLE_MENU_DIR=${envDir}:`, err);
  }
}

export function getFrontendMenuItems(): MenuItem[] {
  return [...cached];
}
