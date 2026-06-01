/**
 * GET /api/supersede — list supersessions from oracle_documents.superseded_by.
 */

import { Elysia } from 'elysia';
import { eq, isNotNull, desc, sql, and } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { db, oracleDocuments } from '../../db/index.ts';
import { SupersedeQuery } from './model.ts';

export const supersedeListEndpoint = new Elysia().get(
  '/supersede',
  ({ query }) => {
    const project = query.project;
    const limit = parseInt(query.limit ?? '50');
    const offset = parseInt(query.offset ?? '0');

    const projectFilter = project ? eq(oracleDocuments.project, project) : undefined;
    const whereClause = projectFilter
      ? and(isNotNull(oracleDocuments.supersededBy), projectFilter)
      : isNotNull(oracleDocuments.supersededBy);

    const countResult = db.select({ total: sql<number>`count(*)` })
      .from(oracleDocuments)
      .where(whereClause)
      .get();
    const total = countResult?.total || 0;

    const newDoc = alias(oracleDocuments, 'new_doc');
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
      .leftJoin(newDoc, eq(oracleDocuments.supersededBy, newDoc.id))
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
