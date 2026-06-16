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
import { normalizeMenuPath } from './path.ts';

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
const MENU_GROUPS = ['main', 'tools', 'hidden', 'admin'] as const;

function writeRaw(items: CustomMenuInput[], file = customMenuFile()): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ items }, null, 2) + '\n');
}

function normalizePath(value: string): string {
  return normalizeMenuPath(value);
}

function normalizeGroup(value: unknown): MenuItem['group'] {
  return MENU_GROUPS.includes(value as MenuItem['group'])
    ? value as MenuItem['group']
    : 'tools';
}

function normalizeOrder(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 90;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeIcon(value: unknown): string | undefined {
  const icon = normalizeText(value);
  return icon || undefined;
}

function normalizeRawItem(value: unknown): CustomMenuInput | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const path = normalizePath(normalizeText(raw.path));
  const label = normalizeText(raw.label);
  if (!path || !label) return null;
  return {
    path,
    label,
    group: normalizeGroup(raw.group),
    order: normalizeOrder(raw.order),
    icon: normalizeIcon(raw.icon),
  };
}

function readRaw(file = customMenuFile()): CustomMenuInput[] {
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as RawFile | CustomMenuInput[];
    const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed.items) ? parsed.items : [];
    return arr.map(normalizeRawItem).filter((item): item is CustomMenuInput => item !== null);
  } catch {
    return [];
  }
}

function cleanInput(input: CustomMenuInput): CustomMenuInput {
  const cleaned = normalizeRawItem(input);
  if (!cleaned) throw new Error('path and label are required');
  return cleaned;
}

export function listCustomMenuItems(file = customMenuFile()): MenuItem[] {
  return readRaw(file).map((i) => ({
    path: i.path,
    label: i.label,
    group: i.group ?? 'tools',
    order: i.order ?? 90,
    icon: i.icon,
    source: 'page' as const,
  }));
}

export function addCustomMenuItem(
  input: CustomMenuInput,
  file = customMenuFile(),
): { added: boolean; replaced: boolean; item: MenuItem } {
  const cleaned = cleanInput(input);
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
