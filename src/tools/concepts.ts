/**
 * Oracle Concepts Handler
 *
 * List all concept tags with document counts.
 */

import { eq, and, ne, isNotNull } from 'drizzle-orm';
import { oracleDocuments } from '../db/schema.ts';
import { currentTenantId } from '../middleware/tenant.ts';
import type { ToolContext, ToolResponse, OracleConceptsInput } from './types.ts';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export const conceptsToolDef = {
  name: 'oracle_concepts',
  description: 'List all concept tags in the Oracle knowledge base with document counts. Useful for discovering what topics are covered and filtering searches.',
  inputSchema: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Maximum number of concepts to return (default: 50)',
        default: 50
      },
      type: {
        type: 'string',
        enum: ['principle', 'pattern', 'learning', 'retro', 'all'],
        description: 'Filter concepts by document type',
        default: 'all'
      }
    },
    required: []
  }
};

function normalizeLimit(limit: number | undefined): number {
  if (!Number.isSafeInteger(limit) || limit === undefined || limit <= 0) return DEFAULT_LIMIT;
  return Math.min(limit, MAX_LIMIT);
}

function conceptNames(raw: string): string[] {
  let values: unknown[] = [];
  try {
    const parsed = JSON.parse(raw);
    values = Array.isArray(parsed) ? parsed : typeof parsed === 'string' ? parsed.split(',') : [];
  } catch {
    values = raw.split(',');
  }

  const unique = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const concept = value.trim();
    if (concept) unique.add(concept);
  }
  return [...unique];
}

export function listConcepts(db: ToolContext['db'], input: OracleConceptsInput) {
  const limit = normalizeLimit(input.limit);
  const type = input.type ?? 'all';

  const filters = [isNotNull(oracleDocuments.concepts), ne(oracleDocuments.concepts, '[]')];
  const tenantId = currentTenantId();
  if (tenantId) filters.push(eq(oracleDocuments.tenantId, tenantId));
  const baseCondition = and(...filters);
  const rows = type === 'all'
    ? db.select({ concepts: oracleDocuments.concepts }).from(oracleDocuments).where(baseCondition).all()
    : db.select({ concepts: oracleDocuments.concepts }).from(oracleDocuments).where(and(baseCondition, eq(oracleDocuments.type, type))).all();

  const conceptCounts = new Map<string, number>();
  for (const row of rows as Array<{ concepts: string }>) {
    for (const concept of conceptNames(row.concepts)) {
      conceptCounts.set(concept, (conceptCounts.get(concept) || 0) + 1);
    }
  }

  const sortedConcepts = Array.from(conceptCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);

  return {
    concepts: sortedConcepts,
    total_unique: conceptCounts.size,
    filter_type: type,
  };
}

export async function handleConcepts(ctx: ToolContext, input: OracleConceptsInput): Promise<ToolResponse> {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(listConcepts(ctx.db, input), null, 2),
    }],
  };
}
