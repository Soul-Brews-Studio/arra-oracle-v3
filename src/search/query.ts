import { augmentQueryWithAcronyms } from './acronyms.ts';

export type SearchMode = 'hybrid' | 'fts' | 'vector';

const SEARCH_MODES = new Set<SearchMode>(['hybrid', 'fts', 'vector']);
const FTS_TOKEN_LIMIT = 32;

function parseWholeNumber(value: string | undefined): number | undefined {
  const normalized = value?.trim();
  if (!normalized || !/^\d+$/.test(normalized)) return undefined;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export function parsePositiveInt(value: string | undefined, fallback: number, max: number): number {
  const parsed = parseWholeNumber(value);
  if (parsed === undefined || parsed < 1) return fallback;
  return Math.min(max, parsed);
}

export function parseOffset(value: string | undefined): number {
  const parsed = parseWholeNumber(value);
  return parsed ?? 0;
}

export function parseSearchMode(value: string | undefined): SearchMode | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return 'hybrid';
  return SEARCH_MODES.has(normalized as SearchMode) ? normalized as SearchMode : null;
}

export function parseConcepts(value: unknown): string[] {
  let parsed: unknown;
  try { parsed = typeof value === 'string' ? JSON.parse(value || '[]') : value; } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const concepts = new Set<string>();
  for (const item of parsed) {
    if (typeof item !== 'string') continue;
    const concept = item.trim();
    if (concept) concepts.add(concept);
  }
  return [...concepts];
}

export function buildTenantFtsQuery(query: string): string {
  const tokens = augmentQueryWithAcronyms(query)
    .replace(/<[^>]*>/g, ' ')
    .normalize('NFKC')
    .match(/[\p{L}\p{N}_]+/gu)
    ?.map((token) => token.trim())
    .filter(Boolean) ?? [];
  return [...new Set(tokens)]
    .slice(0, FTS_TOKEN_LIMIT)
    .map((token) => `"${token.replace(/"/g, '""')}"`)
    .join(' OR ');
}
