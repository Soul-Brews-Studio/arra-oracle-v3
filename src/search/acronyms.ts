export type AcronymExpansion = Readonly<{ short: string; fullForms: readonly string[]; triggers?: readonly string[] }>;

const EXPANSIONS: readonly AcronymExpansion[] = [
  { short: 'CORS', fullForms: ['Cross-Origin Resource Sharing', 'Access-Control-Allow-Origin'], triggers: ['cross origin', 'cross-origin'] },
  { short: 'PNA', fullForms: ['Private Network Access', 'Access-Control-Request-Private-Network'], triggers: ['private network'] },
  { short: 'API', fullForms: ['Application Programming Interface'] },
  { short: 'MCP', fullForms: ['Model Context Protocol'] },
  { short: 'FTS', fullForms: ['Full Text Search'] },
  { short: 'FTS5', fullForms: ['SQLite FTS5', 'Full Text Search'] },
  { short: 'DB', fullForms: ['Database'] },
  { short: 'URL', fullForms: ['Uniform Resource Locator'], triggers: ['vector url', 'vector_url'] },
  { short: 'VECTOR_URL', fullForms: ['Vector URL', 'vector preflight', 'vectorAvailable', 'vectorMode'], triggers: ['vector url', 'vector preflight', 'vector available', 'vector mode'] },
  { short: 'QTA', fullForms: ['Query-Time Augmentation', 'query time augmentation'], triggers: ['query time augmentation', 'query-time augmentation'] },
  { short: 'ITE', fullForms: ['Ingestion-Time Enrichment', 'ingestion time enrichment'], triggers: ['ingestion time enrichment', 'ingestion-time enrichment'] },
] as const;

export const ACRONYM_EXPANSIONS = EXPANSIONS;

export function expansionsForText(text: string): string[] {
  const normalized = normalize(text);
  const additions: string[] = [];
  for (const item of EXPANSIONS) {
    if (!matchesExpansion(normalized, item)) continue;
    additions.push(item.short, ...item.fullForms);
  }
  return uniqueMissing(text, additions);
}

export function augmentQueryWithAcronyms(query: string): string {
  const additions = expansionsForText(query);
  return additions.length ? `${query} ${additions.join(' ')}` : query;
}

export function enrichTextWithAcronyms(text: string): string {
  const additions = expansionsForText(text);
  return additions.length ? `${text}\n\nSearch expansions: ${additions.join('; ')}` : text;
}

function matchesExpansion(normalizedText: string, item: AcronymExpansion): boolean {
  if (containsTerm(normalizedText, item.short)) return true;
  return [item.short, ...item.fullForms, ...(item.triggers ?? [])]
    .some((term) => containsPhrase(normalizedText, term));
}

function uniqueMissing(original: string, values: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalizedOriginal = normalize(original);
  const joinedOriginal = normalizeJoinedTokens(original);
  const out: string[] = [];
  for (const value of values) {
    const key = normalize(value);
    const present = isJoinedAlias(value)
      ? containsJoinedTerm(joinedOriginal, value)
      : containsPhrase(normalizedOriginal, value);
    if (!key || seen.has(key) || present) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function containsTerm(normalizedText: string, term: string): boolean {
  const escaped = normalize(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`, 'i').test(normalizedText);
}

function containsJoinedTerm(normalizedText: string, term: string): boolean {
  const escaped = normalizeJoinedTokens(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`, 'i').test(normalizedText);
}

function containsPhrase(normalizedText: string, phrase: string): boolean {
  return normalizedText.includes(normalize(phrase));
}

function normalize(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[_-]+/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isJoinedAlias(value: string): boolean {
  return /^[A-Z0-9_]+$/.test(value) && value.includes('_');
}

function normalizeJoinedTokens(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/-+/g, '_')
    .replace(/[^\p{L}\p{N}_]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
