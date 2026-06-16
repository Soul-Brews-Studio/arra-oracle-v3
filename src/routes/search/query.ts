export type SearchMode = 'hybrid' | 'fts' | 'vector';

const SEARCH_MODES = new Set<SearchMode>(['hybrid', 'fts', 'vector']);

export function parsePositiveInt(
  value: string | undefined,
  fallback: number,
  max: number,
): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(1, parsed));
}

export function parseOffset(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed);
}

export function parseSearchMode(value: string | undefined): SearchMode | null {
  if (value === undefined || value === '') return 'hybrid';
  return SEARCH_MODES.has(value as SearchMode) ? value as SearchMode : null;
}
