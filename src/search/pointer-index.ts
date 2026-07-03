import type { Database } from 'bun:sqlite';
import { extractEntities } from '../vector/entities.ts';
import { entityKey } from './entity-ranking.ts';

type SqliteLike = Pick<Database, 'prepare'>;
type PointerKind = 'topic' | 'entity' | 'date';
type Pointer = { kind: PointerKind; key: string; label: string };
type PointerRow = { id: string; kind: PointerKind; key: string; doc_ids: string };
type DocRow = { id: string; type: string; source_file: string; concepts: string | null; content: string | null };

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

export function documentPointers(input: PointerInput): Pointer[] {
  return uniquePointers([
    ...conceptValues(input.concepts).map((topic) => pointer('topic', topic)),
    ...extractEntities(input.content, input.concepts).map((entity) => pointer('entity', entity)),
    ...dateKeys(input.timestamp).map((key) => ({ kind: 'date' as const, key, label: key })),
  ]);
}

export function replaceDocumentPointers(sqlite: SqliteLike, input: PointerInput): void {
  try {
    const tenantId = input.tenantId?.trim() || 'default';
    removeDocumentPointers(sqlite, tenantId, [input.documentId]);
    const select = sqlite.prepare('SELECT doc_ids FROM oracle_pointer_index WHERE id = ?');
    const upsert = sqlite.prepare(`
      INSERT INTO oracle_pointer_index (id, tenant_id, kind, key, doc_ids, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET doc_ids = excluded.doc_ids, updated_at = excluded.updated_at
    `);
    const now = Date.now();
    for (const item of documentPointers(input)) {
      const id = pointerId(tenantId, item.kind, item.key);
      const existing = parseIds((select.get(id) as { doc_ids?: string } | undefined)?.doc_ids);
      const docIds = [...new Set([...existing, input.documentId])].sort();
      upsert.run(id, tenantId, item.kind, item.key, JSON.stringify(docIds), now);
    }
  } catch (error) {
    if (!missingPointerTable(error)) throw error;
  }
}

export function removeDocumentPointers(sqlite: SqliteLike, tenantId: string | undefined, documentIds: string[]): void {
  if (documentIds.length === 0) return;
  try {
    const tenant = tenantId?.trim() || 'default';
    const rows = sqlite.prepare('SELECT id, kind, key, doc_ids FROM oracle_pointer_index WHERE tenant_id = ?').all(tenant) as PointerRow[];
    const update = sqlite.prepare('UPDATE oracle_pointer_index SET doc_ids = ?, updated_at = ? WHERE id = ?');
    const del = sqlite.prepare('DELETE FROM oracle_pointer_index WHERE id = ?');
    const remove = new Set(documentIds);
    const now = Date.now();
    for (const row of rows) {
      const next = parseIds(row.doc_ids).filter((id) => !remove.has(id));
      if (next.length === 0) del.run(row.id);
      else if (next.length !== parseIds(row.doc_ids).length) update.run(JSON.stringify(next), now, row.id);
    }
  } catch (error) {
    if (!missingPointerTable(error)) throw error;
  }
}

export function queryPointerIndex(sqlite: SqliteLike, options: PointerSearchOptions): PointerSearchResult[] {
  const limit = Math.max(1, Math.min(100, Math.trunc(options.limit ?? 10)));
  const tenantId = options.tenantId?.trim() || 'default';
  const keys = queryPointers(options.query);
  if (keys.length === 0) return [];
  try {
    const rows = lookupPointerRows(sqlite, tenantId, keys);
    const ranked = rankDocs(rows, keys);
    return hydratePointerDocs(sqlite, ranked, { ...options, tenantId, limit });
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

function lookupPointerRows(sqlite: SqliteLike, tenantId: string, keys: Pointer[]): PointerRow[] {
  const clauses = keys.map(() => '(kind = ? AND key = ?)').join(' OR ');
  if (!clauses) return [];
  const params = keys.flatMap((item) => [item.kind, item.key]);
  return sqlite.prepare(`SELECT id, kind, key, doc_ids FROM oracle_pointer_index WHERE tenant_id = ? AND (${clauses})`)
    .all(tenantId, ...params) as PointerRow[];
}

function rankDocs(rows: PointerRow[], wanted: Pointer[]): Map<string, { score: number; matches: string[] }> {
  const wantedLabels = new Map(wanted.map((item) => [`${item.kind}:${item.key}`, item.label]));
  const ranked = new Map<string, { score: number; matches: string[] }>();
  for (const row of rows) {
    const label = wantedLabels.get(`${row.kind}:${row.key}`) ?? row.key;
    for (const docId of parseIds(row.doc_ids)) {
      const hit = ranked.get(docId) ?? { score: 0, matches: [] };
      hit.score += KIND_WEIGHT[row.kind];
      if (!hit.matches.includes(label)) hit.matches.push(label);
      ranked.set(docId, hit);
    }
  }
  return ranked;
}

function hydratePointerDocs(sqlite: SqliteLike, ranked: Map<string, { score: number; matches: string[] }>, options: Required<Pick<PointerSearchOptions, 'tenantId' | 'limit'>> & PointerSearchOptions): PointerSearchResult[] {
  const ids = [...ranked.keys()];
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const typeFilter = options.type && options.type !== 'all' ? ' AND d.type = ?' : '';
  const projectFilter = options.project ? ' AND (d.project = ? OR d.project IS NULL)' : '';
  const rows = sqlite.prepare(`
    SELECT d.id, d.type, d.source_file, d.concepts, f.content
    FROM oracle_documents d LEFT JOIN oracle_fts f ON f.id = d.id
    WHERE d.tenant_id = ? AND d.id IN (${placeholders})${typeFilter}${projectFilter}
  `).all(options.tenantId, ...ids, ...(options.type && options.type !== 'all' ? [options.type] : []), ...(options.project ? [options.project] : [])) as DocRow[];
  return rows.map((row) => {
    const hit = ranked.get(row.id)!;
    const pointerScore = clamp(hit.score / 1.4);
    return {
      id: row.id,
      type: row.type,
      content: (row.content ?? '').slice(0, 500),
      source_file: row.source_file,
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
