/**
 * GET /api/supersede/chain/:path — forward + backward chain for one doc.
 */

import { Elysia } from 'elysia';
import { and, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { db, oracleDocuments } from '../../db/index.ts';
import { activeTenantId } from '../../middleware/tenant.ts';

export const supersedeChainEndpoint = new Elysia().get(
  '/supersede/chain/:path',
  ({ params }) => {
    const docPath = decodeURIComponent(params.path);
    const tenantId = activeTenantId();
    const targetWhere = and(eq(oracleDocuments.sourceFile, docPath), eq(oracleDocuments.tenantId, tenantId));

    const target = db.select({ id: oracleDocuments.id })
      .from(oracleDocuments)
      .where(targetWhere)
      .get();

    if (!target) {
      return { superseded_by: [], supersedes: [] };
    }

    const newDoc = alias(oracleDocuments, 'new_doc');

    const newDocJoin = and(eq(oracleDocuments.supersededBy, newDoc.id), eq(newDoc.tenantId, tenantId));
    const oldWhere = and(eq(oracleDocuments.id, target.id), eq(oracleDocuments.tenantId, tenantId));
    const newWhere = and(eq(oracleDocuments.supersededBy, target.id), eq(oracleDocuments.tenantId, tenantId));

    const asOld = db.select({
      newPath: newDoc.sourceFile,
      reason: oracleDocuments.supersededReason,
      supersededAt: oracleDocuments.supersededAt,
    })
      .from(oracleDocuments)
      .leftJoin(newDoc, newDocJoin)
      .where(oldWhere)
      .orderBy(oracleDocuments.supersededAt)
      .all()
      .filter(r => r.newPath !== null);

    const asNew = db.select({
      oldPath: oracleDocuments.sourceFile,
      reason: oracleDocuments.supersededReason,
      supersededAt: oracleDocuments.supersededAt,
    })
      .from(oracleDocuments)
      .where(newWhere)
      .orderBy(oracleDocuments.supersededAt)
      .all();

    return {
      superseded_by: asOld.map(r => ({
        new_path: r.newPath,
        reason: r.reason,
        superseded_at: r.supersededAt ? new Date(r.supersededAt).toISOString() : null,
      })),
      supersedes: asNew.map(r => ({
        old_path: r.oldPath,
        reason: r.reason,
        superseded_at: r.supersededAt ? new Date(r.supersededAt).toISOString() : null,
      })),
    };
  },
  {
    detail: {
      tags: ['supersede'],
      menu: { group: 'tools', order: 70 },
      summary: 'Supersession chain for a doc path',
    },
  },
);
