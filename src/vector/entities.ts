import type { VectorDocument } from './types.ts';

export interface EntitySourceDocument extends VectorDocument {
  metadata: VectorDocument['metadata'] & { tenant_id?: string | number };
}

const MAX_ENTITIES_PER_DOC = 12;
const ENTITY_PATTERN = /\b(?:[A-Z][\p{L}\p{N}._-]*(?:\s+[A-Z][\p{L}\p{N}._-]*){0,3}|[a-z][\p{L}\p{N}]+(?:[-_][a-z0-9][\p{L}\p{N}]*)+)\b/gu;
const STOPWORDS = new Set(['The', 'This', 'That', 'These', 'Those', 'When', 'Where', 'What', 'Why', 'How', 'And', 'But', 'For', 'With', 'From']);

export function entityCollectionName(collection: string): string {
  return `${collection}_entities`;
}

export function extractEntities(text: string, concepts?: unknown): string[] {
  const candidates = new Set<string>();
  for (const concept of conceptValues(concepts)) addEntity(candidates, concept);
  for (const match of text.matchAll(ENTITY_PATTERN)) addEntity(candidates, match[0]);
  return [...candidates].slice(0, MAX_ENTITIES_PER_DOC);
}

export function entityDocumentsFor(doc: EntitySourceDocument): VectorDocument[] {
  return extractEntities(doc.document, doc.metadata.concepts).map((entity) => ({
    id: `${doc.id}:entity:${slug(entity)}`,
    document: entity,
    metadata: {
      entity,
      source_doc_id: doc.id,
      tenant_id: doc.metadata.tenant_id ?? '',
      type: 'entity',
    },
  }));
}

function addEntity(out: Set<string>, raw: string): void {
  const entity = raw.replace(/\s+/g, ' ').trim();
  if (entity.length < 3 || STOPWORDS.has(entity)) return;
  out.add(entity);
}

function conceptValues(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((item): item is string => typeof item === 'string');
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return raw.split(',').map((item) => item.trim()).filter(Boolean);
  }
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'entity';
}
