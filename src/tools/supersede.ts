/**
 * Oracle Supersede Handler
 *
 * Mark old documents as superseded by newer ones.
 * "Nothing is Deleted" — old doc preserved but marked outdated.
 */

import { and, eq } from 'drizzle-orm';
import { supersedeWouldCreateCycle } from '../db/document-integrity.ts';
import { oracleDocuments } from '../db/schema.ts';
import { currentTenantId } from '../middleware/tenant.ts';
import type { ToolContext, ToolResponse, OracleSupersededInput } from './types.ts';

type SupersedeRunResult = {
  payload: Record<string, unknown>;
  isError?: boolean;
};
type SupersedeDoc = { id: string; type: string; supersededBy: string | null };

function cleanRequiredId(value: unknown, field: 'oldId' | 'newId'): SupersedeRunResult | string {
  if (typeof value !== 'string') {
    return {
      payload: {
        success: false,
        error: `arra_supersede requires field '${field}' (non-empty string).`,
        received: value === undefined ? 'undefined' : typeof value,
        usage: "arra_supersede({ oldId: 'learning_X', newId: 'learning_Y' })",
      },
      isError: true,
    };
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return {
      payload: {
        success: false,
        error: `arra_supersede requires field '${field}' (non-empty string).`,
        received: 'empty string',
        usage: "arra_supersede({ oldId: 'learning_X', newId: 'learning_Y' })",
      },
      isError: true,
    };
  }
  return trimmed;
}

function cleanOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.trim() || null;
}

function errorResult(error: string, extra: Record<string, unknown> = {}): SupersedeRunResult {
  return { payload: { success: false, error, ...extra }, isError: true };
}

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

export function runSupersede(db: ToolContext['db'], input: OracleSupersededInput): SupersedeRunResult {
  if (input == null || typeof input !== 'object') {
    return {
      payload: {
        success: false,
        error: "arra_supersede requires fields 'oldId' and 'newId' (both non-empty strings).",
        usage: "arra_supersede({ oldId: 'learning_X', newId: 'learning_Y', reason?: 'why' })",
        tip: 'Search for the IDs with arra_search or arra_list first.',
      },
      isError: true,
    };
  }

  const args = input as { oldId?: unknown; newId?: unknown; reason?: unknown };
  const oldIdResult = cleanRequiredId(args.oldId, 'oldId');
  if (typeof oldIdResult !== 'string') return oldIdResult;
  const newIdResult = cleanRequiredId(args.newId, 'newId');
  if (typeof newIdResult !== 'string') return newIdResult;
  const oldId = oldIdResult;
  const newId = newIdResult;
  const reason = cleanOptionalString(args.reason);

  if (oldId === newId) {
    return {
      payload: {
        success: false,
        error: 'arra_supersede oldId and newId must be different documents.',
        received: { oldId, newId },
        tip: 'A document cannot supersede itself. Did you intend to update content via arra_learn instead?',
      },
      isError: true,
    };
  }

  const now = Date.now();
  const tenantId = currentTenantId();
  const docWhere = (id: string) => tenantId
    ? and(eq(oracleDocuments.id, id), eq(oracleDocuments.tenantId, tenantId))
    : eq(oracleDocuments.id, id);
  const selectDoc = {
    id: oracleDocuments.id,
    type: oracleDocuments.type,
    supersededBy: oracleDocuments.supersededBy,
  };
  const oldDoc = db.select(selectDoc).from(oracleDocuments).where(docWhere(oldId)).get() as SupersedeDoc | undefined;
  const newDoc = db.select(selectDoc).from(oracleDocuments).where(docWhere(newId)).get() as SupersedeDoc | undefined;

  if (!oldDoc) throw new Error(`Old document not found: ${oldId}`);
  if (!newDoc) throw new Error(`New document not found: ${newId}`);
  if (oldDoc.supersededBy && oldDoc.supersededBy !== newId) {
    return errorResult('Old document is already superseded by another document.', { oldId, supersededBy: oldDoc.supersededBy });
  }
  if (supersedeWouldCreateCycle(db, oldId, newId, docWhere)) {
    return errorResult('Supersede would create a cycle in the replacement chain.', { oldId, newId });
  }

  db.update(oracleDocuments)
    .set({
      supersededBy: newId,
      supersededAt: now,
      supersededReason: reason,
    })
    .where(docWhere(oldId))
    .run();

  console.error(`[SUPERSEDE] ${oldId} → superseded by → ${newId}`);

  return {
    payload: {
      success: true,
      old_id: oldId,
      old_type: oldDoc.type,
      new_id: newId,
      new_type: newDoc.type,
      reason,
      superseded_at: new Date(now).toISOString(),
      message: `"${oldId}" is now marked as superseded by "${newId}". It will still appear in search results (P-001 Nothing is Deleted), now flagged with "superseded_by", "superseded_at", and "superseded_reason" fields so callers can follow the replacement pointer.`,
    },
  };
}

export async function handleSupersede(ctx: ToolContext, input: OracleSupersededInput): Promise<ToolResponse> {
  const result = runSupersede(ctx.db, input);
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result.payload, null, 2),
    }],
    ...(result.isError ? { isError: true } : {}),
  };
}
