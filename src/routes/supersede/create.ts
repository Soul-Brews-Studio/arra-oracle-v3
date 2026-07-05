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

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.trim() || null;
}

function tenantDocumentError(input: OracleSupersededInput): string | null {
  const { oldId, newId } = input as { oldId?: unknown; newId?: unknown };
  const cleanOldId = cleanString(oldId);
  const cleanNewId = cleanString(newId);
  if (cleanOldId && !documentInActiveTenant(cleanOldId)) return `Old document not found: ${cleanOldId}`;
  if (cleanNewId && !documentInActiveTenant(cleanNewId)) return `New document not found: ${cleanNewId}`;
  return null;
}

export const supersedeCreateEndpoint = new Elysia().post(
  '/supersede',
  ({ body, set }) => {
    try {
      const data = (body ?? {}) as Record<string, any>;
      const oldPath = cleanString(data.old_path);
      if (!oldPath) {
        set.status = 400;
        return { error: 'Missing required field: old_path' };
      }

      const result = db.insert(supersedeLog).values({
        oldPath,
        oldId: cleanString(data.old_id),
        oldTitle: cleanString(data.old_title),
        oldType: cleanString(data.old_type),
        newPath: cleanString(data.new_path),
        newId: cleanString(data.new_id),
        newTitle: cleanString(data.new_title),
        reason: cleanString(data.reason),
        supersededAt: Date.now(),
        supersededBy: cleanString(data.superseded_by) ?? 'user',
        project: cleanString(data.project),
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
