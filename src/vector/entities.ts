import { entityKey } from '../search/entity-key.ts';
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
  // The entity-doc id must be the SAME canonical identity the SQL entity-link
  // side uses (entityKey): Unicode-safe (NFKC + \p{L}\p{N}), so distinct Thai/
  // CJK entities stay distinct instead of collapsing to `<doc>:entity:` (the
  // old ASCII slug turned every Thai entity into the empty string). It is also
  // case/punctuation-folding, so genuinely-same entities (concept "candidate"
  // + text "Candidate", or "sound-therapy" + "SOUND-THERAPY") converge on ONE
  // id. Then dedupe by id, keeping the first occurrence — two source rows for
  // one id make the downstream LanceDB merge-insert ambiguous and abort the
  // whole batch, and (when the target is absent) INSERT genuine duplicate rows.
  // First-occurrence = concepts-before-text order preserved.
  //
  // Empty key -> SKIP (mirrors the SQL side's `if (!key) continue` in
  // entity-ranking.ts): a symbol-only entity (e.g. an emoji concept)
  // canonicalizes to the empty string. Falling back to a literal "entity"
  // would (a) diverge from the SQL side, which writes no link at all, and
  // (b) re-introduce first-wins loss — every distinct symbol-only entity in
  // one doc would collapse onto `<doc>:entity:entity`. (ORA-EBF-20260822-01)
  const byId = new Map<string, VectorDocument>();
  for (const entity of extractEntities(doc.document, doc.metadata.concepts)) {
    const key = entityKey(entity);
    if (!key) continue;
    const id = `${doc.id}:entity:${key}`;
    if (byId.has(id)) continue;
    byId.set(id, {
      id,
      document: entity,
      metadata: {
        entity,
        source_doc_id: doc.id,
        tenant_id: doc.metadata.tenant_id ?? '',
        type: 'entity',
      },
    });
  }
  return [...byId.values()];
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
