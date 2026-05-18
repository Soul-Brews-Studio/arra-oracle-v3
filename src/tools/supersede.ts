/**
 * Oracle Supersede Handler
 *
 * Mark old documents as superseded by newer ones.
 * "Nothing is Deleted" — old doc preserved but marked outdated.
 */

import { eq } from 'drizzle-orm';
import { oracleDocuments } from '../db/schema.ts';
import type { ToolContext, ToolResponse, OracleSupersededInput } from './types.ts';

export const supersedeToolDef = {
  name: 'muninn_supersede',
  description: 'Mark an old learning/document as superseded by a newer one. Aligns with "Nothing is Deleted" - old doc preserved but marked outdated.',
  inputSchema: {
    type: 'object',
    properties: {
      oldId: {
        type: 'string',
        description: 'ID of the document being superseded (the outdated one)'
      },
      newId: {
        type: 'string',
        description: 'ID of the document that supersedes it (the current one)'
      },
      reason: {
        type: 'string',
        description: 'Why the old document is outdated (optional)'
      }
    },
    required: ['oldId', 'newId']
  }
};

export async function handleSupersede(ctx: ToolContext, input: OracleSupersededInput): Promise<ToolResponse> {
  const { oldId, newId, reason } = input;
  const now = Date.now();

  const oldDoc = ctx.db.select({ id: oracleDocuments.id, type: oracleDocuments.type })
    .from(oracleDocuments)
    .where(eq(oracleDocuments.id, oldId))
    .get();
  const newDoc = ctx.db.select({ id: oracleDocuments.id, type: oracleDocuments.type })
    .from(oracleDocuments)
    .where(eq(oracleDocuments.id, newId))
    .get();

  if (!oldDoc) throw new Error(`Old document not found: ${oldId}`);
  if (!newDoc) throw new Error(`New document not found: ${newId}`);

  ctx.db.update(oracleDocuments)
    .set({
      supersededBy: newId,
      supersededAt: now,
      supersededReason: reason || null,
    })
    .where(eq(oracleDocuments.id, oldId))
    .run();

  console.error(`[MCP:SUPERSEDE] ${oldId} → superseded by → ${newId}`);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        old_id: oldId,
        old_type: oldDoc.type,
        new_id: newId,
        new_type: newDoc.type,
        reason: reason || null,
        superseded_at: new Date(now).toISOString(),
        message: `"${oldId}" is now marked as superseded by "${newId}". It will still appear in search results (P-001 Nothing is Deleted), now flagged with "superseded_by", "superseded_at", and "superseded_reason" fields so callers can follow the replacement pointer.`
      }, null, 2)
    }]
  };
}
