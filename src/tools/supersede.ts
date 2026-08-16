/**
 * Oracle Supersede Handler
 *
 * Mark old documents as superseded by newer ones.
 * "Nothing is Deleted" — old doc preserved but marked outdated.
 */

import { and, eq, isNull } from 'drizzle-orm';
import { oracleDocuments } from '../db/schema.ts';
import { currentTenantId } from '../middleware/tenant.ts';
import type { ToolContext, ToolResponse, OracleSupersededInput } from './types.ts';

type SupersedeRunResult = {
  payload: Record<string, unknown>;
  isError?: boolean;
};

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

  const expectActive = (args as { expectActive?: unknown }).expectActive === true;

  // expectActive mode (opt-in, recovery-style callers): the old-row read, the
  // successor-chain cycle check, the conditional update, and the affected-row
  // verification below must be one atomic unit — otherwise a racing writer can
  // supersede the old row or mutate the successor chain between check and
  // update. Default mode keeps the existing non-transactional behavior.
  if (expectActive) {
    return db.transaction((tx) => runSupersedeCore(tx as ToolContext['db'], oldId, newId, reason, true));
  }
  return runSupersedeCore(db, oldId, newId, reason, false);
}

function runSupersedeCore(
  db: ToolContext['db'],
  oldId: string,
  newId: string,
  reason: string | null,
  expectActive: boolean,
): SupersedeRunResult {
  const now = Date.now();
  const tenantId = currentTenantId();
  const docWhere = (id: string) => tenantId
    ? and(eq(oracleDocuments.id, id), eq(oracleDocuments.tenantId, tenantId))
    : eq(oracleDocuments.id, id);
  const successorFor = (id: string) => db.select({ supersededBy: oracleDocuments.supersededBy })
    .from(oracleDocuments)
    .where(docWhere(id))
    .get()?.supersededBy ?? null;
  const oldDoc = db.select({
    id: oracleDocuments.id,
    type: oracleDocuments.type,
    supersededBy: oracleDocuments.supersededBy,
    supersededAt: oracleDocuments.supersededAt,
    supersededReason: oracleDocuments.supersededReason,
  })
    .from(oracleDocuments)
    .where(docWhere(oldId))
    .get();
  const newDoc = db.select({ id: oracleDocuments.id, type: oracleDocuments.type })
    .from(oracleDocuments)
    .where(docWhere(newId))
    .get();

  if (!oldDoc) throw new Error(`Old document not found: ${oldId}`);
  if (!newDoc) throw new Error(`New document not found: ${newId}`);
  if (oldDoc.supersededBy) {
    if (oldDoc.supersededBy === newId) {
      return {
        payload: {
          success: true,
          unchanged: true,
          old_id: oldId,
          old_type: oldDoc.type,
          new_id: newId,
          new_type: newDoc.type,
          reason: oldDoc.supersededReason,
          superseded_at: oldDoc.supersededAt ? new Date(oldDoc.supersededAt).toISOString() : null,
          message: `"${oldId}" is already marked as superseded by "${newId}".`,
        },
      };
    }
    return {
      payload: {
        success: false,
        error: `"${oldId}" is already superseded by "${oldDoc.supersededBy}". Supersede that successor to extend the chain instead of rewriting history.`,
        received: { oldId, newId, existingNewId: oldDoc.supersededBy },
      },
      isError: true,
    };
  }
  for (let cursor: string | null = newId, seen = new Set<string>(); cursor;) {
    if (cursor === oldId) {
      return { payload: { success: false, error: 'arra_supersede would create a supersede cycle.', received: { oldId, newId } }, isError: true };
    }
    if (seen.has(cursor)) break;
    seen.add(cursor);
    cursor = successorFor(cursor);
  }

  if (expectActive) {
    // CAS: only an old row that is still active may be superseded; a raced
    // competing supersede leaves changes !== 1 and aborts the transaction.
    db.update(oracleDocuments)
      .set({
        supersededBy: newId,
        supersededAt: now,
        supersededReason: reason,
      })
      .where(and(docWhere(oldId), isNull(oracleDocuments.supersededBy), isNull(oracleDocuments.supersededAt)))
      .run();
    // Verify inside the same transaction: the conditional update either landed
    // exactly on the still-active row, or the row was raced and is unchanged.
    const verify = db.select({ supersededBy: oracleDocuments.supersededBy, supersededAt: oracleDocuments.supersededAt })
      .from(oracleDocuments)
      .where(docWhere(oldId))
      .get();
    if (verify?.supersededBy !== newId || verify.supersededAt == null) {
      throw new Error(`expectActive supersede raced: "${oldId}" is no longer active (now superseded by ${verify?.supersededBy ?? 'unknown'})`);
    }
  } else {
    db.update(oracleDocuments)
      .set({
        supersededBy: newId,
        supersededAt: now,
        supersededReason: reason,
      })
      .where(docWhere(oldId))
      .run();
  }

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
