/**
 * GET /api/supersede — list supersessions from oracle_documents.superseded_by.
 */

import { Elysia } from 'elysia';
import { eq, isNotNull, desc, sql, and } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { db, oracleDocuments } from '../../db/index.ts';
import { SupersedeQuery } from './model.ts';
import { activeTenantId } from '../../middleware/tenant.ts';

function boundedInteger(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

export const supersedeListEndpoint = new Elysia().get(
  '/supersede',
  ({ query }) => {
    const project = query.project;
    const limit = boundedInteger(query.limit, 50, 1, 200);
    const offset = boundedInteger(query.offset, 0, 0, 100_000);

    const tenantId = activeTenantId();
    const filters = [isNotNull(oracleDocuments.supersededBy), eq(oracleDocuments.tenantId, tenantId)];
    if (project) filters.push(eq(oracleDocuments.project, project));
    const whereClause = and(...filters);

    const countResult = db.select({ total: sql<number>`count(*)` })
      .from(oracleDocuments)
      .where(whereClause)
      .get();
    const total = countResult?.total || 0;

    const newDoc = alias(oracleDocuments, 'new_doc');
    const newDocJoin = and(eq(oracleDocuments.supersededBy, newDoc.id), eq(newDoc.tenantId, tenantId));
    const rows = db.select({
      oldId: oracleDocuments.id,
      oldPath: oracleDocuments.sourceFile,
      oldType: oracleDocuments.type,
      newId: oracleDocuments.supersededBy,
      newPath: newDoc.sourceFile,
      newType: newDoc.type,
      reason: oracleDocuments.supersededReason,
      supersededAt: oracleDocuments.supersededAt,
      project: oracleDocuments.project,
    })
      .from(oracleDocuments)
      .leftJoin(newDoc, newDocJoin)
      .where(whereClause)
      .orderBy(desc(oracleDocuments.supersededAt))
      .limit(limit)
      .offset(offset)
      .all();

    return {
      supersessions: rows.map(r => ({
        old_id: r.oldId,
        old_path: r.oldPath,
        old_type: r.oldType,
        new_id: r.newId,
        new_path: r.newPath,
        new_type: r.newType,
        reason: r.reason,
        superseded_at: r.supersededAt ? new Date(r.supersededAt).toISOString() : null,
        project: r.project,
      })),
      total,
      limit,
      offset,
    };
  },
  {
    query: SupersedeQuery,
    detail: {
      tags: ['supersede'],
      menu: { group: 'tools', path: '/superseded', order: 60 },
      summary: 'List superseded documents',
    },
  },
);
