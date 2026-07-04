import { and, eq, inArray, isNull, or, type SQL } from 'drizzle-orm';
import type { Database } from 'bun:sqlite';
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import * as schema from '../db/schema.ts';
import { extractEntities } from '../vector/entities.ts';
import { entityKey } from './entity-ranking.ts';

type OracleDb = BunSQLiteDatabase<typeof schema>;
type OracleDbInput = OracleDb | Database;
type PointerKind = 'topic' | 'entity' | 'date';
type Pointer = { kind: PointerKind; key: string; label: string };
type PointerRow = { id: string; kind: PointerKind; key: string; docIds: string };
type DocRow = { id: string; type: string; sourceFile: string; concepts: string | null; content: string | null };

const oracleFts = sqliteTable('oracle_fts', {
  id: text('id'),
  content: text('content'),
  concepts: text('concepts'),
});

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
const KIND_WEIGHT: Record<PointerKind, number> = { entity: 0.55, topic: 0.35, date: 0.25 };

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

function rankDocs(rows: PointerRow[], wanted: Pointer[]): Map<string, { score: number; matches: string[] }> {
  const wantedLabels = new Map(wanted.map((item) => [`${item.kind}:${item.key}`, item.label]));
  const ranked = new Map<string, { score: number; matches: string[] }>();
  for (const row of rows) {
    const label = wantedLabels.get(`${row.kind}:${row.key}`) ?? row.key;
    for (const docId of parseIds(row.docIds)) {
      const hit = ranked.get(docId) ?? { score: 0, matches: [] };
      hit.score += KIND_WEIGHT[row.kind];
      if (!hit.matches.includes(label)) hit.matches.push(label);
      ranked.set(docId, hit);
    }
  }
  return ranked;
}

function hydratePointerDocs(db: OracleDb, ranked: Map<string, { score: number; matches: string[] }>, options: Required<Pick<PointerSearchOptions, 'tenantId' | 'limit'>> & PointerSearchOptions): PointerSearchResult[] {
  const ids = [...ranked.keys()];
  if (ids.length === 0) return [];
  const filters = [
    eq(schema.oracleDocuments.tenantId, options.tenantId),
    inArray(schema.oracleDocuments.id, ids),
    ...(options.type && options.type !== 'all' ? [eq(schema.oracleDocuments.type, options.type)] : []),
    ...(options.project ? [or(eq(schema.oracleDocuments.project, options.project), isNull(schema.oracleDocuments.project))] : []),
  ];
  const rows = db.select({
    id: schema.oracleDocuments.id,
    type: schema.oracleDocuments.type,
    sourceFile: schema.oracleDocuments.sourceFile,
    concepts: schema.oracleDocuments.concepts,
    content: oracleFts.content,
  }).from(schema.oracleDocuments)
    .leftJoin(oracleFts, eq(oracleFts.id, schema.oracleDocuments.id))
    .where(and(...filters))
    .all() as DocRow[];
  return rows.map((row) => {
    const hit = ranked.get(row.id)!;
    const pointerScore = clamp(hit.score / 1.4);
    return {
      id: row.id,
      type: row.type,
      content: (row.content ?? '').slice(0, 500),
      source_file: row.sourceFile,
      concepts: conceptValues(row.concepts),
      score: pointerScore,
      source: 'pointer' as const,
      pointerScore,
      pointerMatches: hit.matches.slice(0, 8),
    };
  }).sort((a, b) => b.pointerScore - a.pointerScore).slice(0, options.limit);
}

function pointer(kind: PointerKind, value: string): Pointer { return { kind, key: entityKey(value), label: value.trim() }; }
function pointerId(tenantId: string, kind: PointerKind, key: string): string { return `${tenantId}:${kind}:${key}`; }
function uniquePointers(items: Pointer[]): Pointer[] {
  const out = new Map<string, Pointer>();
  for (const item of items) if (item.key) out.set(`${item.kind}:${item.key}`, item);
  return [...out.values()];
}
function adjacent(words: string[]): string[] { return words.slice(0, -1).map((word, i) => `${word} ${words[i + 1]}`); }
function parseIds(raw: string | undefined): string[] {
  try { const parsed = JSON.parse(raw || '[]'); return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : []; } catch { return []; }
}
function conceptValues(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : []; } catch { return raw.split(',').map((item) => item.trim()).filter(Boolean); }
}
function dateKeys(timestamp: number | undefined): string[] {
  if (!timestamp || !Number.isFinite(timestamp)) return [];
  const iso = new Date(timestamp).toISOString();
  return [iso.slice(0, 4), iso.slice(0, 7), iso.slice(0, 10)];
}
function dateKeysFromText(text: string): string[] {
  const keys = new Set<string>();
  for (const match of text.matchAll(/\b(19\d{2}|20\d{2})(?:[-/](0?[1-9]|1[0-2])(?:[-/](0?[1-9]|[12]\d|3[01]))?)?\b/g)) {
    const [, year, month, day] = match;
    keys.add(year);
    if (month) keys.add(`${year}-${month.padStart(2, '0')}`);
    if (month && day) keys.add(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
  }
  return [...keys];
}
function clamp(value: number): number { return Number.isFinite(value) ? Math.max(0, Math.min(1, Number(value.toFixed(6)))) : 0; }
function missingPointerTable(error: unknown): boolean { return String(error instanceof Error ? error.message : error).includes('oracle_pointer_index'); }
