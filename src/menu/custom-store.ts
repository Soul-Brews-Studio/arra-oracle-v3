/**
 * Custom menu items — user-added entries stored at ORACLE_DATA_DIR/custom-menu.json.
 *
 * Not tied to any sqlite schema so users can hand-edit / back up / reset the file
 * independently. Merges into the aggregated /api/menu with source:'page' + added:true.
 */

import fs from 'fs';
import path from 'path';
import type { MenuItem } from '../routes/menu/model.ts';
import { ORACLE_DATA_DIR } from '../config.ts';
import { tenantDataPath } from '../middleware/tenant.ts';

export const CUSTOM_MENU_FILE = path.join(ORACLE_DATA_DIR, 'custom-menu.json');

export function customMenuFile(): string {
  return tenantDataPath(CUSTOM_MENU_FILE);
}

export interface CustomMenuInput {
  path: string;
  label: string;
  group?: MenuItem['group'];
  order?: number;
  icon?: string;
}

type RawFile = { items?: CustomMenuInput[] };

function readRaw(file = customMenuFile()): CustomMenuInput[] {
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as RawFile | CustomMenuInput[];
    const arr = Array.isArray(parsed) ? parsed : parsed.items ?? [];
    return arr.filter(
      (i): i is CustomMenuInput =>
        !!i && typeof i.path === 'string' && typeof i.label === 'string',
    );
  } catch {
    return [];
  }
}

function writeRaw(items: CustomMenuInput[], file = customMenuFile()): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ items }, null, 2) + '\n');
}

function normalizePath(p: string): string {
  const trimmed = p.trim();
  if (!trimmed) return trimmed;
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export function listCustomMenuItems(file = customMenuFile()): MenuItem[] {
  return readRaw(file).map((i) => ({
    path: normalizePath(i.path),
    label: i.label,
    group: i.group ?? 'tools',
    order: typeof i.order === 'number' ? i.order : 90,
    icon: i.icon,
    source: 'page' as const,
  }));
}

export function addCustomMenuItem(
  input: CustomMenuInput,
  file = customMenuFile(),
): { added: boolean; replaced: boolean; item: MenuItem } {
  const cleaned: CustomMenuInput = {
    path: normalizePath(input.path),
    label: input.label,
    group: input.group ?? 'tools',
    order: typeof input.order === 'number' ? input.order : 90,
    icon: input.icon,
  };
  const existing = readRaw(file);
  const idx = existing.findIndex((i) => normalizePath(i.path) === cleaned.path);
  let replaced = false;
  if (idx >= 0) {
    existing[idx] = cleaned;
    replaced = true;
  } else {
    existing.push(cleaned);
  }
  writeRaw(existing, file);
  const item: MenuItem = {
    path: cleaned.path,
    label: cleaned.label,
    group: cleaned.group!,
    order: cleaned.order!,
    icon: cleaned.icon,
    source: 'page',
  };
  return { added: !replaced, replaced, item };
}

export function removeCustomMenuItem(
  rawPath: string,
  file = customMenuFile(),
): { removed: boolean; path: string } {
  const target = normalizePath(rawPath);
  const existing = readRaw(file);
  const next = existing.filter((i) => normalizePath(i.path) !== target);
  const removed = next.length !== existing.length;
  if (removed) writeRaw(next, file);
  return { removed, path: target };
}
