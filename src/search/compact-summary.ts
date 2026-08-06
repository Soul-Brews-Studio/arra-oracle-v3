export type SearchRetrievalMode = 'full' | 'compact-summary';

export type CompactSearchMetadata = {
  mode: 'compact-summary';
  maxContentChars: number;
  maxSummaryChars: number;
  originalContentChars: number;
  returnedContentChars: number;
  savedContentChars: number;
  savingsRatio: number;
};

type SearchResultRecord = Record<string, unknown> & { content?: unknown };

const MAX_CONTENT_CHARS = 240;
const MAX_SUMMARY_CHARS = 180;

export function parseSearchRetrievalMode(value: unknown): { ok: true; mode: SearchRetrievalMode } | { ok: false; error: string } {
  if (value === undefined || value === null || value === '') return { ok: true, mode: 'full' };
  if (typeof value !== 'string') return { ok: false, error: 'retrieval must be a string' };
  const mode = value.trim().toLowerCase();
  if (mode === 'full' || mode === 'compact-summary') return { ok: true, mode };
  if (mode === 'compact' || mode === 'summary') return { ok: true, mode: 'compact-summary' };
  return { ok: false, error: 'Invalid retrieval mode. Expected one of: full, compact-summary' };
}

export function compactSearchResults<T extends SearchResultRecord>(
  results: T[],
  query: string,
): { results: Array<T & { compact: true; summary: string; content_chars: { original: number; returned: number } }>; metadata: CompactSearchMetadata } {
  let originalContentChars = 0;
  let returnedContentChars = 0;

  const compacted = results.map((result) => {
    const original = plainText(String(result.content ?? ''));
    const summary = summarizeMemory(original, query, MAX_SUMMARY_CHARS);
    const snippet = querySnippet(original, query, MAX_CONTENT_CHARS) || summary;
    const content = truncateText(snippet, MAX_CONTENT_CHARS);
    originalContentChars += original.length;
    returnedContentChars += content.length;
    return {
      ...result,
      content,
      summary,
      compact: true as const,
      content_chars: { original: original.length, returned: content.length },
    };
  });

  const savedContentChars = Math.max(0, originalContentChars - returnedContentChars);
  return {
    results: compacted,
    metadata: {
      mode: 'compact-summary',
      maxContentChars: MAX_CONTENT_CHARS,
      maxSummaryChars: MAX_SUMMARY_CHARS,
      originalContentChars,
      returnedContentChars,
      savedContentChars,
      savingsRatio: originalContentChars ? Number((savedContentChars / originalContentChars).toFixed(3)) : 0,
    },
  };
}

function plainText(input: string): string {
  return input
    .replace(/^---[\s\S]*?---/m, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#>*_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function summarizeMemory(content: string, query: string, maxChars: number): string {
  const sentences = splitSentences(content);
  const tokens = queryTokens(query);
  const scored = sentences.map((sentence, index) => ({
    sentence,
    index,
    score: overlapScore(sentence, tokens),
  }));
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  const selected = scored[0]?.sentence || content;
  return truncateText(selected, maxChars);
}

function querySnippet(content: string, query: string, maxChars: number): string {
  if (!content) return '';
  const lower = content.toLowerCase();
  const tokens = queryTokens(query);
  const firstHit = tokens
    .map((token) => lower.indexOf(token))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  if (firstHit === undefined) return truncateText(content, maxChars);
  const start = Math.max(0, firstHit - Math.floor(maxChars / 3));
  const end = Math.min(content.length, start + maxChars);
  return `${start > 0 ? '…' : ''}${content.slice(start, end)}${end < content.length ? '…' : ''}`;
}

function splitSentences(content: string): string[] {
  return content
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function queryTokens(query: string): string[] {
  return Array.from(new Set(query.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []))
    .filter((token) => token.length > 2);
}

function overlapScore(sentence: string, tokens: string[]): number {
  const lower = sentence.toLowerCase();
  return tokens.reduce((score, token) => score + (lower.includes(token) ? 1 : 0), 0);
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars - 1);
  const boundary = slice.search(/\s+\S*$/);
  const base = boundary > maxChars * 0.6 ? slice.slice(0, boundary) : slice;
  return `${base.trimEnd()}…`;
}
