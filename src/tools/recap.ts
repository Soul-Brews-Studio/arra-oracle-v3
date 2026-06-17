import { currentTenantId } from '../middleware/tenant.ts';
import { MCP_SERVER_NAME } from '../const.ts';
import type { ToolContext, ToolResponse, OracleRecapInput } from './types.ts';

type RecapRow = {
  id: string;
  type: string;
  source_file: string;
  concepts: string | null;
  updated_at: number;
  indexed_at: number;
  project: string | null;
  usage_count: number;
  last_accessed_at: number | null;
  content: string | null;
};

type RankedRow = RecapRow & {
  conceptsList: string[];
  projectLabel: string;
  heat: number;
  confidence: number;
  rank: number;
};

const DEFAULT_TOP_N = 8;
const DEFAULT_MAX_TOKENS = 900;
const MAX_TOP_N = 20;
const MAX_TOKENS = 1200;
const DAY_MS = 24 * 60 * 60 * 1000;

export const recapToolDef = {
  name: 'oracle_recap',
  description: 'Emit a compact session-start Oracle wake-up context: identity plus top memories by heat/confidence grouped by project.',
  inputSchema: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Top memories to include (1-20)', default: DEFAULT_TOP_N },
      maxTokens: { type: 'number', description: 'Approximate output token budget (200-1200)', default: DEFAULT_MAX_TOKENS },
    },
    required: [],
  },
};

export async function handleRecap(ctx: ToolContext, input: OracleRecapInput = {}): Promise<ToolResponse> {
  const limit = boundedNumber(input.limit, DEFAULT_TOP_N, 1, MAX_TOP_N);
  const maxTokens = boundedNumber(input.maxTokens, DEFAULT_MAX_TOKENS, 200, MAX_TOKENS);
  const tenantId = currentTenantId();
  const rows = fetchRows(ctx, Math.max(limit * 6, 30), tenantId);
  const ranked = rows.map((row) => rankRow(row)).sort((a, b) => b.rank - a.rank).slice(0, limit);
  const text = fitBudget(renderRecap(ctx, ranked, rows.length, maxTokens, tenantId), ranked, ctx, rows.length, maxTokens, tenantId);
  return { content: [{ type: 'text', text }] };
}

function fetchRows(ctx: ToolContext, limit: number, tenantId: string | undefined): RecapRow[] {
  const tenantClause = tenantId ? 'AND d.tenant_id = ?' : '';
  return ctx.sqlite.prepare(`
    SELECT d.id, d.type, d.source_file, d.concepts, d.updated_at, d.indexed_at,
      d.project, d.usage_count, d.last_accessed_at, f.content
    FROM oracle_documents d
    LEFT JOIN oracle_fts f ON d.id = f.id
    WHERE d.superseded_by IS NULL ${tenantClause}
    ORDER BY d.usage_count DESC, COALESCE(d.last_accessed_at, d.updated_at) DESC
    LIMIT ?
  `).all(...(tenantId ? [tenantId] : []), limit) as RecapRow[];
}

function rankRow(row: RecapRow, now = Date.now()): RankedRow {
  const usageCount = safeNumber(row.usage_count);
  const ageDays = daysSince(row.updated_at || row.indexed_at, now);
  const accessDays = row.last_accessed_at ? daysSince(row.last_accessed_at, now) : undefined;
  const freshness = halfLife(ageDays, 120);
  const access = accessDays === undefined ? 0 : halfLife(accessDays, 30);
  const usage = Math.min(1, Math.log1p(usageCount) / Math.log1p(20));
  const conceptsList = parseConcepts(row.concepts);
  const provenance = Math.min(1, (row.source_file ? 0.45 : 0) + (conceptsList.length ? 0.35 : 0) + (row.project ? 0.2 : 0));
  const heat = round((usage * 0.55) + (access * 0.3) + (freshness * 0.15));
  const confidence = round((freshness * 0.45) + (provenance * 0.35) + (usage * 0.2));
  return {
    ...row,
    conceptsList,
    projectLabel: projectLabel(row),
    heat,
    confidence,
    rank: round((heat * 0.6) + (confidence * 0.4)),
  };
}

function renderRecap(
  ctx: ToolContext,
  rows: RankedRow[],
  total: number,
  maxTokens: number,
  tenantId: string | undefined,
): string {
  const groups = groupByProject(rows);
  const tokenPlaceholder = '__TOKENS__';
  const lines = [
    '# Oracle wake-up context',
    `Identity: ${MCP_SERVER_NAME} v${ctx.version}; vector=${ctx.vectorStatus}; tenant=${tenantId ?? 'default'}; docs=${total}.`,
    'Role: MCP memory/search layer. Start with oracle_search for recall, oracle_read for exact source, oracle_learn for new durable facts.',
    `Budget: approx ${tokenPlaceholder} / ${maxTokens} tokens; ranked by heat + confidence.`,
  ];
  if (rows.length === 0) lines.push('', 'No memories indexed yet. Ingest with `arra mine <dir>` or add facts with `oracle_learn`.');
  for (const [project, projectRows] of groups) {
    lines.push('', `## ${project}`);
    for (const row of projectRows) lines.push(itemLine(row));
  }
  const text = lines.join('\n');
  return text.replace(tokenPlaceholder, String(estimateTokens(text)));
}

function itemLine(row: RankedRow): string {
  const title = firstLine(row.content) || row.source_file || row.id;
  const concepts = row.conceptsList.slice(0, 3).join(', ') || 'untagged';
  const snippet = compact(row.content ?? '', 150);
  return `- ${compact(title, 88)} [${row.type}; heat ${row.heat}; conf ${row.confidence}; concepts: ${concepts}; id: ${row.id}] ${snippet}`;
}

function fitBudget(
  text: string,
  rows: RankedRow[],
  ctx: ToolContext,
  total: number,
  maxTokens: number,
  tenantId: string | undefined,
): string {
  let kept = rows;
  let next = text;
  while (estimateTokens(next) > maxTokens && kept.length > 1) {
    kept = kept.slice(0, -1);
    next = renderRecap(ctx, kept, total, maxTokens, tenantId);
  }
  if (estimateTokens(next) <= maxTokens) return next;
  const maxChars = Math.max(100, maxTokens * 4 - 32);
  return `${next.slice(0, maxChars).trimEnd()}\n… truncated to wake-up budget`;
}

function groupByProject(rows: RankedRow[]): Map<string, RankedRow[]> {
  const grouped = new Map<string, RankedRow[]>();
  for (const row of rows) grouped.set(row.projectLabel, [...(grouped.get(row.projectLabel) ?? []), row]);
  return new Map([...grouped.entries()].sort((a, b) => b[1][0].rank - a[1][0].rank));
}

function projectLabel(row: RecapRow): string {
  const explicit = row.project?.trim();
  if (explicit) return explicit;
  const parts = row.source_file.split('/').filter(Boolean);
  return parts.length > 1 ? parts[0] : 'unscoped';
}

function parseConcepts(raw: string | null): string[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return raw.split(',').map((item) => item.trim()).filter(Boolean);
  }
}

function firstLine(value: string | null): string {
  return value?.split('\n').find((line) => line.trim())?.trim() ?? '';
}

function compact(value: string, max: number): string {
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned.length <= max ? cleaned : `${cleaned.slice(0, max - 1).trimEnd()}…`;
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('oracle_recap numeric inputs must be finite numbers');
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function daysSince(timestamp: number, now: number): number {
  return Math.max(0, (now - safeNumber(timestamp)) / DAY_MS);
}

function halfLife(days: number, halfLifeDays: number): number {
  return Math.max(0, Math.min(1, 0.5 ** (days / halfLifeDays)));
}

function safeNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
