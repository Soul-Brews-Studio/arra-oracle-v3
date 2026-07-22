/**
 * Concept Graph — thin entity/relation layer on top of hybrid search.
 *
 * Populated as a side effect whenever a document's concept tags become
 * known (oracle_learn today; the indexer can call this too). Lets
 * oracle_concepts do graph-style "what co-occurs with X" navigation on
 * top of, not instead of, the existing FTS5+vector retrieval pipeline.
 *
 * Deliberately minimal: one relation type ('co-occurs-with', symmetric,
 * recorded once per unordered pair per document) rather than a full
 * subject/predicate/object extraction pipeline — that would need an LLM
 * pass this deterministic tool-handler layer doesn't have access to.
 */

import { and, eq } from 'drizzle-orm';
import { conceptEntities, conceptRelations } from '../db/schema.ts';
import type { ToolContext } from './types.ts';

export function slugifyConcept(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function upsertEntity(db: ToolContext['db'], name: string, now: number): string | null {
  const id = slugifyConcept(name);
  if (!id) return null;

  const existing = db.select({ id: conceptEntities.id })
    .from(conceptEntities)
    .where(eq(conceptEntities.id, id))
    .get();

  if (existing) {
    db.update(conceptEntities).set({ name, updatedAt: now }).where(eq(conceptEntities.id, id)).run();
  } else {
    db.insert(conceptEntities).values({ id, name, type: 'concept', createdAt: now, updatedAt: now }).run();
  }
  return id;
}

function relationExists(db: ToolContext['db'], subjectId: string, objectId: string, sourceDocId: string): boolean {
  return db.select({ id: conceptRelations.id })
    .from(conceptRelations)
    .where(and(
      eq(conceptRelations.subjectId, subjectId),
      eq(conceptRelations.objectId, objectId),
      eq(conceptRelations.sourceDocId, sourceDocId),
    ))
    .get() !== undefined;
}

/**
 * Record concept entities + pairwise co-occurrence relations for a document.
 * Best-effort: never throws (graph population is additive, not load-bearing —
 * a failure here must not break oracle_learn's actual document write).
 */
export function recordConceptRelations(
  db: ToolContext['db'],
  sourceDocId: string,
  concepts: string[],
  now: number = Date.now(),
): void {
  try {
    const unique = Array.from(new Set(concepts.map(c => c.trim()).filter(Boolean)));
    if (unique.length === 0) return;

    const ids = unique.map(name => upsertEntity(db, name, now)).filter((id): id is string => id !== null);

    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const [subjectId, objectId] = [ids[i], ids[j]].sort();
        if (relationExists(db, subjectId, objectId, sourceDocId)) continue;
        db.insert(conceptRelations).values({
          subjectId,
          predicate: 'co-occurs-with',
          objectId,
          sourceDocId,
          createdAt: now,
        }).run();
      }
    }
  } catch (error) {
    console.error('[ConceptGraph] Failed to record relations (non-fatal):', error instanceof Error ? error.message : String(error));
  }
}

/** Concepts directly related to `name` via recorded co-occurrence, with occurrence counts. */
export function getRelatedConcepts(db: ToolContext['db'], name: string, limit = 20): Array<{ name: string; count: number }> {
  const id = slugifyConcept(name);
  if (!id) return [];

  const asSubject = db.select({ objectId: conceptRelations.objectId })
    .from(conceptRelations)
    .where(eq(conceptRelations.subjectId, id))
    .all();
  const asObject = db.select({ subjectId: conceptRelations.subjectId })
    .from(conceptRelations)
    .where(eq(conceptRelations.objectId, id))
    .all();

  const neighborIds = [
    ...asSubject.map(r => r.objectId),
    ...asObject.map(r => r.subjectId),
  ];
  if (neighborIds.length === 0) return [];

  const counts = new Map<string, number>();
  for (const neighborId of neighborIds) {
    counts.set(neighborId, (counts.get(neighborId) || 0) + 1);
  }

  const entities = db.select({ id: conceptEntities.id, name: conceptEntities.name })
    .from(conceptEntities)
    .all();
  const nameById = new Map(entities.map(e => [e.id, e.name]));

  return Array.from(counts.entries())
    .map(([neighborId, count]) => ({ name: nameById.get(neighborId) || neighborId, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
