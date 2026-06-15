import type { SearchResult } from '../types';

export function titleFor(result: SearchResult): string {
  return result.title || result.source_file || result.id;
}

export function previewFor(result: SearchResult): string {
  const text = result.content || 'No preview returned.';
  return text.length > 320 ? `${text.slice(0, 320)}…` : text;
}

export function scoreLabel(score?: number): string | null {
  if (typeof score !== 'number') return null;
  return `${Math.round(score * 100)}%`;
}
