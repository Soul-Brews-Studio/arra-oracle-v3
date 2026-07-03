import type { ThemeDefinition } from './types';

const all: ThemeDefinition[] = [];
const byId = new Map<string, ThemeDefinition>();

export function registerTheme(theme: ThemeDefinition): void {
  if (byId.has(theme.id)) return;
  all.push(theme);
  byId.set(theme.id, theme);
}

export function getThemes(): ThemeDefinition[] {
  return all;
}

export function getTheme(id: string): ThemeDefinition | undefined {
  return byId.get(id);
}

export const DEFAULT_THEME_ID = 'oracle-default';
