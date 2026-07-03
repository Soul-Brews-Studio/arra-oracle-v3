import type { ThemeDefinition } from './types';
import { oracleDefault } from './oracle-default';
import { midnightTeal } from './midnight-teal';
import { emeraldNoir } from './emerald-noir';
import { sakura } from './sakura';

const all: ThemeDefinition[] = [oracleDefault, midnightTeal, emeraldNoir, sakura];

const byId = new Map(all.map((t) => [t.id, t]));

export function getThemes(): ThemeDefinition[] {
  return all;
}

export function getTheme(id: string): ThemeDefinition | undefined {
  return byId.get(id);
}

export function registerTheme(theme: ThemeDefinition): void {
  if (byId.has(theme.id)) return;
  all.push(theme);
  byId.set(theme.id, theme);
}

export const DEFAULT_THEME_ID = 'oracle-default';
