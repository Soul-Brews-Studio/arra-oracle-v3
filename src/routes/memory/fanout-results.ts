import type { SearchResult } from '../../server/types.ts';
import type { VectorQueryResult } from '../../vector/types.ts';
import { safeVectorDistance, scoreFromVectorDistance } from './fanout-score.ts';

export type FanoutSearchResult = SearchResult & {
  title?: string;
  tags?: string[];
  memorySource?: string;
  createdAt?: string;
  updatedAt?: string;
  usageCount?: number;
  lastAccessedAt?: string;
};

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function dateText(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  return text(value);
}

function textList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return textList(parsed);
  } catch {}
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

export function toFanoutSearchResults(collection: string, result: VectorQueryResult): FanoutSearchResult[] {
  return result.ids.map((id, index) => {
    const metadata = result.metadatas?.[index] ?? {};
    const distance = safeVectorDistance(result.distances?.[index]);
    const tags = textList(metadata.tags).length ? textList(metadata.tags) : textList(metadata.concepts);
    return {
      id,
      type: metadata.type ?? 'unknown',
      content: result.documents?.[index] ?? '',
      source_file: metadata.source_file ?? metadata.path ?? '',
      concepts: textList(metadata.concepts),
      source: 'vector',
      score: scoreFromVectorDistance(distance),
      distance,
      model: collection,
      title: text(metadata.title),
      tags,
      memorySource: text(metadata.source ?? metadata.memory_source ?? metadata.source_file ?? metadata.path),
      createdAt: dateText(metadata.createdAt ?? metadata.created_at),
      updatedAt: dateText(metadata.updatedAt ?? metadata.updated_at),
      usageCount: numberValue(metadata.usageCount ?? metadata.usage_count),
      lastAccessedAt: dateText(metadata.lastAccessedAt ?? metadata.last_accessed_at),
      superseded_by: text(metadata.superseded_by ?? metadata.supersededBy),
      superseded_at: dateText(metadata.superseded_at ?? metadata.supersededAt),
      superseded_reason: text(metadata.superseded_reason ?? metadata.supersededReason),
    };
  });
}
