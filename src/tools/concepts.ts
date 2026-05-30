/**
 * Oracle Concepts Handler
 *
 * List all concept tags with document counts.
 */

import { eq, and, ne, isNotNull } from 'drizzle-orm';
import { oracleDocuments } from '../db/schema.ts';
import type { ToolContext, ToolResponse, OracleConceptsInput } from './types.ts';

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

export async function handleConcepts(ctx: ToolContext, input: OracleConceptsInput): Promise<ToolResponse> {
  const { limit = 50, type = 'all' } = input;

  const baseCondition = and(isNotNull(oracleDocuments.concepts), ne(oracleDocuments.concepts, '[]'));
  const rows = type === 'all'
    ? ctx.db.select({ concepts: oracleDocuments.concepts }).from(oracleDocuments).where(baseCondition).all()
    : ctx.db.select({ concepts: oracleDocuments.concepts }).from(oracleDocuments).where(and(baseCondition, eq(oracleDocuments.type, type))).all();

  const conceptCounts = new Map<string, number>();
  for (const row of rows as Array<{ concepts: string }>) {
    try {
      const concepts = JSON.parse(row.concepts);
      if (Array.isArray(concepts)) {
        for (const concept of concepts) {
          if (typeof concept === 'string') {
            conceptCounts.set(concept, (conceptCounts.get(concept) || 0) + 1);
          }
        }
      }
    } catch {
      if (typeof row.concepts === 'string') {
        const concepts = row.concepts.split(',').map(c => c.trim()).filter(Boolean);
        for (const concept of concepts) {
          conceptCounts.set(concept, (conceptCounts.get(concept) || 0) + 1);
        }
      }
    }
  }

  const sortedConcepts = Array.from(conceptCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        concepts: sortedConcepts,
        total_unique: conceptCounts.size,
        filter_type: type,
      }, null, 2)
    }]
  };
}
