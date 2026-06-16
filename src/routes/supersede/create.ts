/**
 * POST /api/supersede — append to legacy supersede_log table.
 *
 * Kept for backwards compatibility; the MCP write path populates
 * oracle_documents.superseded_by directly, not this table.
 */

import { Elysia } from 'elysia';
import { db, supersedeLog } from '../../db/index.ts';
import { runSupersede } from '../../tools/supersede.ts';
import type { OracleSupersededInput } from '../../tools/types.ts';
import { SupersedeBody, SupersedeDocumentBody } from './model.ts';

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
      return {
        id: result.id,
        message: 'Supersession logged',
      };
    } catch (error) {
      set.status = 500;
      return { error: error instanceof Error ? error.message : 'Unknown error' };
    }
  },
  {
    body: SupersedeBody,
    detail: {
      tags: ['supersede'],
      menu: { group: 'hidden' },
      summary: 'Append to legacy supersede_log',
    },
  },
);

export const supersedeDocumentEndpoint = new Elysia().post(
  '/supersede/document',
  ({ body, set }) => {
    try {
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
    detail: {
      tags: ['supersede'],
      summary: 'Mark an indexed document as superseded by another document',
    },
  },
);
