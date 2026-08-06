import { and, eq, or, type SQL } from 'drizzle-orm';
import type { Database } from 'bun:sqlite';
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import * as schema from '../db/schema.ts';
import { extractEntities } from '../vector/entities.ts';
import { expansionPhrasesForText } from './acronyms.ts';
import { conceptValues, dateKeys, dateKeysFromText, parseIds, rankDocs } from './pointer-ranking.ts';
import { hydratePointerDocs } from './pointer-hydrate.ts';
import { entityKey } from './entity-ranking.ts';

type OracleDb = BunSQLiteDatabase<typeof schema>;
type OracleDbInput = OracleDb | Database;
type PointerKind = 'topic' | 'entity' | 'date';
type Pointer = { kind: PointerKind; key: string; label: string };
export type PointerKindName = PointerKind;
type PointerRow = { id: string; kind: PointerKind; key: string; docIds: string };


export type PointerInput = {
  documentId: string;
  tenantId?: string;
  content: string;
  concepts?: unknown;
  timestamp?: number;
};
export type PointerSearchResult = {
  id: string; type: string; content: string; source_file: string; concepts: string[];
  score: number; source: 'pointer'; pointerScore: number; pointerMatches: string[];
};
export type PointerSearchOptions = {
  query: string; type?: string; project?: string | null; tenantId?: string; limit?: number;
};

const STOPWORDS = new Set(['and', 'are', 'for', 'from', 'into', 'the', 'this', 'that', 'with', 'what', 'when', 'where']);

function toDb(input: OracleDbInput): OracleDb {
  return 'prepare' in input ? drizzle(input, { schema }) : input;
}

export function documentPointers(input: PointerInput): Pointer[] {
  return uniquePointers([
    ...conceptValues(input.concepts).map((topic) => pointer('topic', topic)),
    ...extractEntities(input.content, input.concepts).map((entity) => pointer('entity', entity)),
    ...dateKeys(input.timestamp).map((key) => ({ kind: 'date' as const, key, label: key })),
  ]);
}

export function replaceDocumentPointers(dbInput: OracleDbInput, input: PointerInput): void {
  try {
    const db = toDb(dbInput);
    const tenantId = input.tenantId?.trim() || 'default';
    removeDocumentPointers(db, tenantId, [input.documentId]);
    const now = Date.now();
    for (const item of documentPointers(input)) {
      const id = pointerId(tenantId, item.kind, item.key);
      const existingRow = db.select({ docIds: schema.oraclePointerIndex.docIds })
        .from(schema.oraclePointerIndex)
        .where(eq(schema.oraclePointerIndex.id, id))
        .get();
      const existing = parseIds(existingRow?.docIds);
      const docIds = [...new Set([...existing, input.documentId])].sort();
      db.insert(schema.oraclePointerIndex)
        .values({ id, tenantId, kind: item.kind, key: item.key, docIds: JSON.stringify(docIds), updatedAt: now })
        .onConflictDoUpdate({
          target: schema.oraclePointerIndex.id,
          set: { docIds: JSON.stringify(docIds), updatedAt: now },
        })
        .run();
    }
  } catch (error) {
    if (!missingPointerTable(error)) throw error;
  }
}

export function removeDocumentPointers(dbInput: OracleDbInput, tenantId: string | undefined, documentIds: string[]): void {
  if (documentIds.length === 0) return;
  try {
    const db = toDb(dbInput);
    const tenant = tenantId?.trim() || 'default';
    const rows = db.select({
      id: schema.oraclePointerIndex.id,
      kind: schema.oraclePointerIndex.kind,
      key: schema.oraclePointerIndex.key,
      docIds: schema.oraclePointerIndex.docIds,
    }).from(schema.oraclePointerIndex)
      .where(eq(schema.oraclePointerIndex.tenantId, tenant))
      .all() as PointerRow[];
    const remove = new Set(documentIds);
    const now = Date.now();
    for (const row of rows) {
      const existing = parseIds(row.docIds);
      const next = existing.filter((id) => !remove.has(id));
      if (next.length === 0) {
        db.delete(schema.oraclePointerIndex).where(eq(schema.oraclePointerIndex.id, row.id)).run();
      } else if (next.length !== existing.length) {
        db.update(schema.oraclePointerIndex)
          .set({ docIds: JSON.stringify(next), updatedAt: now })
          .where(eq(schema.oraclePointerIndex.id, row.id))
          .run();
      }
    }
  } catch (error) {
    if (!missingPointerTable(error)) throw error;
  }
}

export function queryPointerIndex(dbInput: OracleDbInput, options: PointerSearchOptions): PointerSearchResult[] {
  const db = toDb(dbInput);
  const limit = Math.max(1, Math.min(100, Math.trunc(options.limit ?? 10)));
  const tenantId = options.tenantId?.trim() || 'default';
  const keys = queryPointers(options.query);
  if (keys.length === 0) return [];
  try {
    const rows = lookupPointerRows(db, tenantId, keys);
    const ranked = rankDocs(rows, keys);
    return hydratePointerDocs(db, ranked, { ...options, tenantId, limit });
  } catch (error) {
    if (missingPointerTable(error)) return [];
    throw error;
  }
}

export function queryPointers(query: string): Pointer[] {
  const words = query.normalize('NFKC').match(/[\p{L}\p{N}][\p{L}\p{N}._-]{2,}/gu)
    ?.map((word) => word.toLowerCase()).filter((word) => !STOPWORDS.has(word)) ?? [];
  return uniquePointers([
    ...words.map((word) => pointer('topic', word)),
    ...adjacent(words).map((phrase) => pointer('topic', phrase)),
    ...extractEntities(query).map((entity) => pointer('entity', entity)),
    // Acronym expansions as known phrases, not recovered from the text.
    //
    // `augmentQueryWithAcronyms` appends expansions bare, so two of them end up adjacent and
    // `extractEntities` merges them: "what does the API and db do" yields the entity pointer
    // `application-programming-interface-database`, and the real
    // `application-programming-interface` is absent. Single-word expansions like `database`
    // survive only by accident — every word is also added as an entity pointer below — so the
    // loss is silent and hits multi-word expansions only. Same defect as #2876, second signal.
    ...expansionPhrasesForText(query).map((expansion) => pointer('entity', expansion)),
    ...words.map((word) => pointer('entity', word)),
    ...dateKeysFromText(query).map((key) => ({ kind: 'date' as const, key, label: key })),
  ]).slice(0, 24);
}

function lookupPointerRows(db: OracleDb, tenantId: string, keys: Pointer[]): PointerRow[] {
  const clauses = keys.map((item) => and(
    eq(schema.oraclePointerIndex.kind, item.kind),
    eq(schema.oraclePointerIndex.key, item.key),
  )).filter((clause): clause is SQL => clause !== undefined);
  const pointerMatch = or(...clauses);
  if (!pointerMatch) return [];
  return db.select({
    id: schema.oraclePointerIndex.id,
    kind: schema.oraclePointerIndex.kind,
    key: schema.oraclePointerIndex.key,
    docIds: schema.oraclePointerIndex.docIds,
  }).from(schema.oraclePointerIndex)
    .where(and(eq(schema.oraclePointerIndex.tenantId, tenantId), pointerMatch))
    .all() as PointerRow[];
}

function pointer(kind: PointerKind, value: string): Pointer { return { kind, key: entityKey(value), label: value.trim() }; }
function pointerId(tenantId: string, kind: PointerKind, key: string): string { return `${tenantId}:${kind}:${key}`; }
function uniquePointers(items: Pointer[]): Pointer[] {
  const out = new Map<string, Pointer>();
  for (const item of items) if (item.key) out.set(`${item.kind}:${item.key}`, item);
  return [...out.values()];
}
function adjacent(words: string[]): string[] { return words.slice(0, -1).map((word, i) => `${word} ${words[i + 1]}`); }

function missingPointerTable(error: unknown): boolean { return String(error instanceof Error ? error.message : error).includes('oracle_pointer_index'); }
