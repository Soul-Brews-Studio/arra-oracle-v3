/**
 * POST /api/supersede — append to legacy supersede_log table.
 *
 * Kept for backwards compatibility; the MCP write path populates
 * oracle_documents.superseded_by directly, not this table.
 */

import { Elysia } from 'elysia';
import { and, eq } from 'drizzle-orm';
import { db, oracleDocuments, supersedeLog } from '../../db/index.ts';
import { activeTenantId } from '../../middleware/tenant.ts';
import { runSupersede } from '../../tools/supersede.ts';
import type { OracleSupersededInput } from '../../tools/types.ts';
import { SupersedeBody, SupersedeDocumentBody } from './model.ts';

function documentInActiveTenant(id: string): boolean {
  return Boolean(db.select({ id: oracleDocuments.id }).from(oracleDocuments)
    .where(and(eq(oracleDocuments.id, id), eq(oracleDocuments.tenantId, activeTenantId()))).get());
}

function tenantDocumentError(input: OracleSupersededInput): string | null {
  const { oldId, newId } = input as { oldId?: unknown; newId?: unknown };
  if (typeof oldId === 'string' && oldId && !documentInActiveTenant(oldId)) return `Old document not found: ${oldId}`;
  if (typeof newId === 'string' && newId && !documentInActiveTenant(newId)) return `New document not found: ${newId}`;
  return null;
}

export const supersedeCreateEndpoint = new Elysia().post(
  '/supersede',
  ({ body, set }) => {
    try {
      const data = (body ?? {}) as Record<string, any>;
      if (!data.old_path) {
        set.status = 400;
        return { error: 'Missing required field: old_path' };
      }

      const result = db.insert(supersedeLog).values({
        oldPath: data.old_path,
        oldId: data.old_id || null,
        oldTitle: data.old_title || null,
        oldType: data.old_type || null,
        newPath: data.new_path || null,
        newId: data.new_id || null,
        newTitle: data.new_title || null,
        reason: data.reason || null,
        supersededAt: Date.now(),
        supersededBy: data.superseded_by || 'user',
        project: data.project || null,
      }).returning({ id: supersedeLog.id }).get();

      set.status = 201;
      return { id: result.id, message: 'Supersession logged' };
    } catch (error) {
      set.status = 500;
      return { error: error instanceof Error ? error.message : 'Unknown error' };
    }
  },
  {
    body: SupersedeBody,
    detail: { tags: ['supersede'], menu: { group: 'hidden' }, summary: 'Append to legacy supersede_log' },
  },
);

export const supersedeDocumentEndpoint = new Elysia().post(
  '/supersede/document',
  ({ body, set }) => {
    try {
      const tenantError = tenantDocumentError(body as OracleSupersededInput);
      if (tenantError) {
        set.status = 404;
        return { success: false, error: tenantError };
      }
      const result = runSupersede(db, body as OracleSupersededInput);
      if (result.isError) set.status = 400;
      return result.payload;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      set.status = message.includes('not found') ? 404 : 500;
      return { success: false, error: message };
    }
  },
  {
    body: SupersedeDocumentBody,
    detail: { tags: ['supersede'], summary: 'Mark an indexed document as superseded by another document' },
  },
);
