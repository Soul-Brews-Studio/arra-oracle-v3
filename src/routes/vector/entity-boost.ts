import type { Database } from 'bun:sqlite';
import { getScopedSetting } from '../../db/scoped-settings.ts';
import { DEFAULT_TENANT_ID } from '../../middleware/tenant.ts';
import { entityKey } from '../../search/entity-ranking.ts';
import { extractEntities } from '../../vector/entities.ts';
import { memoryConfidence } from '../memory/confidence.ts';
import type { MemoryRecord } from '../memory/store.ts';

export const ENTITY_BOOST_CAP_SETTING = 'vector.entity_boost_cap';
export const ENTITY_ALIASES_SETTING = 'vector.entity_aliases';
export const DEFAULT_ENTITY_BOOST_CAP = 1.5;
export const MAX_ENTITY_BOOST_CAP = 3;

const STOPWORDS = new Set(['a', 'an', 'and', 'are', 'but', 'for', 'from', 'how', 'the', 'this', 'that', 'what', 'when', 'where', 'with', 'why']);
const STRATEGY = 'entity_link_confidence_heat_capped_multiplier';

type BoostHit = {
  id: string;
  score?: number;
  content?: string;
  source_file?: string;
  concepts?: string[];
  metadata?: Record<string, unknown>;
  type?: string;
};
type LinkRow = { documentId: string; entity: string; entityKey: string; weight: number };
type DocRow = {
  id: string; sourceFile?: string; concepts?: string; createdAt?: number; updatedAt?: number;
  usageCount?: number; lastAccessedAt?: number;
};
type AliasRule = { alias: string; entity: string };
export type EntityBoostSettings = { cap: number; aliases: AliasRule[] };

export type EntityBoostFields = {
  entity_score?: number;
  entity_matches?: string[];
  entity_boost?: {
    factor: number; cap: number; baseScore: number; preBoostScore: number;
    confidence: number; heat: number; strategy: typeof STRATEGY;
  };
};

export function vectorEntityBoostSettings(read = getScopedSetting): EntityBoostSettings {
  return {
    cap: parseCap(read(ENTITY_BOOST_CAP_SETTING)),
    aliases: parseAliases(read(ENTITY_ALIASES_SETTING)),
  };
}

export function applyVectorEntityBoost<T extends BoostHit>(
  db: Database,
  hits: T[],
  query: string,
  options: { tenantId?: string; settings?: EntityBoostSettings; now?: Date } = {},
): Array<T & EntityBoostFields> {
  if (hits.length === 0) return hits;
  const tenantId = options.tenantId?.trim() || DEFAULT_TENANT_ID;
  const settings = options.settings ?? vectorEntityBoostSettings();
  const keys = entityKeysForQuery(query, settings.aliases);
  const ids = hits.map((hit) => hit.id).filter(Boolean).slice(0, 100);
  const docs = readDocs(db, ids, tenantId);
  const links = keys.length ? readLinks(db, ids, keys, tenantId) : new Map<string, LinkRow[]>();

  return hits.map((hit) => {
    const confidence = confidenceForHit(hit, docs.get(hit.id), options.now);
    const baseScore = finiteScore(hit.score);
    const heat = confidence.components.usage;
    const preBoostScore = round6(clamp((baseScore * 0.72) + (confidence.score * 0.18) + (heat * 0.1)));
    const matches = links.get(hit.id) ?? [];
    const factor = matches.length ? settings.cap : 1;
    const score = round6(preBoostScore * factor);
    return {
      ...hit,
      score,
      ...(matches.length ? {
        entity_score: round3(factor - 1),
        entity_matches: matches.map((match) => match.entity),
        entity_boost: { factor, cap: settings.cap, baseScore, preBoostScore, confidence: confidence.score, heat, strategy: STRATEGY },
      } : {}),
    };
  });
}

export function entityKeysForQuery(query: string, aliases: AliasRule[] = []): string[] {
  const keys = new Set(extractEntities(query).map(entityKey).filter(Boolean));
  const words = query.normalize('NFKC').match(/[\p{L}\p{N}][\p{L}\p{N}._-]{1,}/gu)
    ?.map((word) => word.toLowerCase()).filter((word) => !STOPWORDS.has(word)) ?? [];
  for (const word of words) keys.add(entityKey(word));
  for (let i = 0; i < words.length - 1; i += 1) keys.add(entityKey(`${words[i]} ${words[i + 1]}`));
  const lower = ` ${query.normalize('NFKC').toLowerCase()} `;
  for (const rule of aliases) {
    const aliasKey = entityKey(rule.alias);
    if (keys.has(aliasKey) || lower.includes(` ${rule.alias.toLowerCase()} `)) keys.add(entityKey(rule.entity));
  }
  return [...keys].filter(Boolean).slice(0, 24);
}

function readLinks(db: Database, ids: string[], keys: string[], tenantId: string): Map<string, LinkRow[]> {
  const out = new Map<string, LinkRow[]>();
  if (!ids.length || !keys.length) return out;
  try {
    const rows = db.query<LinkRow, any[]>(`
      SELECT document_id AS documentId, entity, entity_key AS entityKey, weight
      FROM oracle_entity_links
      WHERE tenant_id = ? AND document_id IN (${marks(ids)}) AND entity_key IN (${marks(keys)})
    `).all(tenantId, ...ids, ...keys);
    for (const row of rows) out.set(row.documentId, [...(out.get(row.documentId) ?? []), row]);
  } catch (error) {
    if (!missingSchema(error)) throw error;
  }
  return out;
}

function readDocs(db: Database, ids: string[], tenantId: string): Map<string, DocRow> {
  const out = new Map<string, DocRow>();
  if (!ids.length) return out;
  try {
    const rows = db.query<DocRow, any[]>(`
      SELECT id, source_file AS sourceFile, concepts, created_at AS createdAt, updated_at AS updatedAt,
        usage_count AS usageCount, last_accessed_at AS lastAccessedAt
      FROM oracle_documents
      WHERE tenant_id = ? AND id IN (${marks(ids)})
    `).all(tenantId, ...ids);
    for (const row of rows) out.set(row.id, row);
  } catch (error) {
    if (!missingSchema(error)) throw error;
  }
  return out;
}

function confidenceForHit(hit: BoostHit, doc?: DocRow, now?: Date) {
  const metadata = hit.metadata ?? {};
  const memory: MemoryRecord = {
    id: hit.id,
    content: hit.content ?? '',
    source: text(hit.source_file ?? metadata.source_file ?? doc?.sourceFile),
    tags: list(hit.concepts ?? metadata.concepts ?? doc?.concepts),
    createdAt: time(metadata.created_at ?? metadata.createdAt ?? doc?.createdAt) ?? new Date(0).toISOString(),
    updatedAt: time(metadata.updated_at ?? metadata.updatedAt ?? doc?.updatedAt) ?? new Date().toISOString(),
    usageCount: number(metadata.usage_count ?? metadata.usageCount ?? doc?.usageCount) ?? 0,
    lastAccessedAt: time(metadata.last_accessed_at ?? metadata.lastAccessedAt ?? doc?.lastAccessedAt),
    tier: 'warm',
    heatScore: 0,
  };
  return memoryConfidence(memory, { mode: 'semantic', semanticScore: finiteScore(hit.score), now });
}

function parseCap(value: string | null): number {
  const parsed = Number(value ?? process.env.ORACLE_VECTOR_ENTITY_BOOST_CAP ?? DEFAULT_ENTITY_BOOST_CAP);
  if (!Number.isFinite(parsed)) return DEFAULT_ENTITY_BOOST_CAP;
  return Math.max(1, Math.min(MAX_ENTITY_BOOST_CAP, parsed));
}

function parseAliases(raw: string | null): AliasRule[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    return Object.entries(parsed).flatMap(([alias, value]) => {
      const values = Array.isArray(value) ? value : [value];
      return values.filter((item): item is string => typeof item === 'string').map((entity) => ({ alias, entity }));
    })
      .filter((rule) => rule.alias.trim() && rule.entity.trim());
  } catch {
    return [];
  }
}

function marks(values: unknown[]): string {
  return values.map(() => '?').join(',');
}

function missingSchema(error: unknown): boolean {
  const message = String(error instanceof Error ? error.message : error);
  return message.includes('no such table') || message.includes('no such column');
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return list(parsed);
  } catch {}
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function time(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === 'string' && value.trim()) return value;
  return undefined;
}

function number(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function finiteScore(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function clamp(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
