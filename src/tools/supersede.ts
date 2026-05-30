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
  name: 'oracle_supersede',
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
  if (input == null || typeof input !== 'object') {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: "arra_supersede requires fields 'oldId' and 'newId' (both non-empty strings).",
          usage: "arra_supersede({ oldId: 'learning_X', newId: 'learning_Y', reason?: 'why' })",
          tip: "Search for the IDs with arra_search or arra_list first."
        }, null, 2)
      }],
      isError: true
    };
  }
  const { oldId, newId, reason } = input as { oldId?: unknown; newId?: unknown; reason?: unknown };
  if (typeof oldId !== 'string' || oldId.length === 0) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: "arra_supersede requires field 'oldId' (non-empty string).",
          received: oldId === undefined ? 'undefined' : typeof oldId,
          usage: "arra_supersede({ oldId: 'learning_X', newId: 'learning_Y' })"
        }, null, 2)
      }],
      isError: true
    };
  }
  if (typeof newId !== 'string' || newId.length === 0) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: "arra_supersede requires field 'newId' (non-empty string).",
          received: newId === undefined ? 'undefined' : typeof newId,
          usage: "arra_supersede({ oldId: 'learning_X', newId: 'learning_Y' })"
        }, null, 2)
      }],
      isError: true
    };
  }
  if (oldId === newId) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: "arra_supersede oldId and newId must be different documents.",
          received: { oldId, newId },
          tip: "A document cannot supersede itself. Did you intend to update content via arra_learn instead?"
        }, null, 2)
      }],
      isError: true
    };
  }
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
      supersededReason: typeof reason === 'string' ? reason : null,
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
