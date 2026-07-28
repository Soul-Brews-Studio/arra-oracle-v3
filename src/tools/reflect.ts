/**
 * Oracle Reflect Handler
 *
 * Return random wisdom from the knowledge base.
 */

import { sql, inArray } from 'drizzle-orm';
import { oracleDocuments } from '../db/schema.ts';
import type { ToolContext, ToolResponse, OracleReflectInput } from './types.ts';

export const reflectToolDef = {
  name: 'oracle_reflect',
  description: 'Get a random principle or learning for reflection. Use this for periodic wisdom or to align with Oracle philosophy.',
  inputSchema: {
    type: 'object',
    properties: {}
  }
};

export async function handleReflect(ctx: ToolContext, _input: OracleReflectInput): Promise<ToolResponse> {
  const randomDoc = ctx.db.select({
    id: oracleDocuments.id,
    type: oracleDocuments.type,
    sourceFile: oracleDocuments.sourceFile,
    concepts: oracleDocuments.concepts,
  })
    .from(oracleDocuments)
    .where(inArray(oracleDocuments.type, ['principle', 'learning']))
    .orderBy(sql`RANDOM()`)
    .limit(1)
    .get();

  if (!randomDoc) {
    throw new Error('No documents found in Oracle knowledge base');
  }

  const content = ctx.sqlite.prepare(`
    SELECT content FROM oracle_fts WHERE id = ?
  `).get(randomDoc.id) as { content: string } | undefined;

  if (!content) {
    throw new Error('Document content not found in FTS index');
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        principle: {
          id: randomDoc.id,
          type: randomDoc.type,
          content: content.content,
          source_file: randomDoc.sourceFile,
          concepts: JSON.parse(randomDoc.concepts || '[]')
        }
      }, null, 2)
    }]
  };
}
