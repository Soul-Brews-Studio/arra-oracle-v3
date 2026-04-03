/**
 * Oracle v2 Dashboard Handlers
 *
 * Refactored to use Drizzle ORM for type-safe queries.
 */

import { sql, gt, and, gte, lt, desc } from 'drizzle-orm';
import { db, oracleDocuments, searchLog, learnLog } from '../db/index.ts';
import type { DashboardSummary, DashboardActivity, DashboardGrowth } from './types.ts';

/**
 * Dashboard summary - aggregated stats for the dashboard
 */
export function handleDashboardSummary(): DashboardSummary {
  // Document counts
  const totalDocsResult = db.select({ count: sql<number>`count(*)` })
    .from(oracleDocuments)
    .get();
  const totalDocs = totalDocsResult?.count || 0;

  const byTypeResults = db.select({
    type: oracleDocuments.type,
    count: sql<number>`count(*)`
  })
    .from(oracleDocuments)
    .groupBy(oracleDocuments.type)
    .all();

  // Concept counts - need to parse JSON concepts from all documents
  const conceptsResult = db.select({ concepts: oracleDocuments.concepts })
    .from(oracleDocuments)
    .where(and(
      sql`${oracleDocuments.concepts} IS NOT NULL`,
      sql`${oracleDocuments.concepts} != '[]'`
    ))
    .all();

  const conceptCounts = new Map<string, number>();
  for (const row of conceptsResult) {
    try {
      const concepts = JSON.parse(row.concepts);
      if (Array.isArray(concepts)) {
        concepts.forEach((c: string) => {
          conceptCounts.set(c, (conceptCounts.get(c) || 0) + 1);
        });
      }
    } catch { /* invalid JSON in concepts field — skip row */ }
  }

  const topConcepts = Array.from(conceptCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Activity counts (last 7 days)
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  let searches7d = 0;
  let learnings7d = 0;

  try {
    const searchResult = db.select({ count: sql<number>`count(*)` })
      .from(searchLog)
      .where(gt(searchLog.createdAt, sevenDaysAgo))
      .get();
    searches7d = searchResult?.count || 0;
  } catch { /* searchLog table may not exist yet */ }

  try {
    const learnResult = db.select({ count: sql<number>`count(*)` })
      .from(learnLog)
      .where(gt(learnLog.createdAt, sevenDaysAgo))
      .get();
    learnings7d = learnResult?.count || 0;
  } catch { /* learnLog table may not exist yet */ }

  // Health status
  const lastIndexedResult = db.select({ lastIndexed: sql<number | null>`max(${oracleDocuments.indexedAt})` })
    .from(oracleDocuments)
    .get();

  return {
    documents: {
      total: totalDocs,
      by_type: byTypeResults.reduce((acc, row) => ({ ...acc, [row.type]: row.count }), {})
    },
    concepts: {
      total: conceptCounts.size,
      top: topConcepts
    },
    activity: {
      searches_7d: searches7d,
      learnings_7d: learnings7d
    },
    health: {
      fts_status: totalDocs > 0 ? 'healthy' : 'empty',
      last_indexed: lastIndexedResult?.lastIndexed
        ? new Date(lastIndexedResult.lastIndexed).toISOString()
        : null
    }
  };
}

/**
 * Dashboard activity - recent consultations, searches, learnings
 */
export function handleDashboardActivity(days: number = 7): DashboardActivity {
  const since = Date.now() - days * 24 * 60 * 60 * 1000;

  // Recent searches
  let searches: DashboardActivity['searches'] = [];
  try {
    const rows = db.select({
      query: searchLog.query,
      type: searchLog.type,
      resultsCount: searchLog.resultsCount,
      searchTimeMs: searchLog.searchTimeMs,
      createdAt: searchLog.createdAt
    })
      .from(searchLog)
      .where(gt(searchLog.createdAt, since))
      .orderBy(desc(searchLog.createdAt))
      .limit(20)
      .all();

    searches = rows.map(row => ({
      query: row.query.substring(0, 100),
      type: row.type,
      results_count: row.resultsCount,
      search_time_ms: row.searchTimeMs,
      created_at: new Date(row.createdAt).toISOString()
    }));
  } catch { /* searchLog table may not exist yet */ }

  // Recent learnings
  let learnings: DashboardActivity['learnings'] = [];
  try {
    const rows = db.select({
      documentId: learnLog.documentId,
      patternPreview: learnLog.patternPreview,
      source: learnLog.source,
      concepts: learnLog.concepts,
      createdAt: learnLog.createdAt
    })
      .from(learnLog)
      .where(gt(learnLog.createdAt, since))
      .orderBy(desc(learnLog.createdAt))
      .limit(20)
      .all();

    learnings = rows.map(row => ({
      document_id: row.documentId,
      pattern_preview: row.patternPreview,
      source: row.source,
      concepts: JSON.parse(row.concepts || '[]'),
      created_at: new Date(row.createdAt).toISOString()
    }));
  } catch { /* learnLog table may not exist yet */ }

  return { searches, learnings, days };
}

/**
 * Dashboard growth - documents and activity over time
 */
export function handleDashboardGrowth(period: string = 'week'): DashboardGrowth {
  const daysMap: Record<string, number> = {
    week: 7,
    month: 30,
    quarter: 90
  };
  const days = daysMap[period] || 7;

  // Get daily document counts
  const data: DashboardGrowth['data'] = [];

  for (let i = 0; i < days; i++) {
    const dayStart = Date.now() - (days - i) * 24 * 60 * 60 * 1000;
    const dayEnd = dayStart + 24 * 60 * 60 * 1000;
    const date = new Date(dayStart).toISOString().split('T')[0];

    // Documents created that day
    const docsResult = db.select({ count: sql<number>`count(*)` })
      .from(oracleDocuments)
      .where(and(
        gte(oracleDocuments.createdAt, dayStart),
        lt(oracleDocuments.createdAt, dayEnd)
      ))
      .get();

    // Searches that day
    let searchCount = 0;
    try {
      const searchResult = db.select({ count: sql<number>`count(*)` })
        .from(searchLog)
        .where(and(
          gte(searchLog.createdAt, dayStart),
          lt(searchLog.createdAt, dayEnd)
        ))
        .get();
      searchCount = searchResult?.count || 0;
    } catch { /* searchLog table may not exist yet */ }

    data.push({
      date,
      documents: docsResult?.count || 0,
      searches: searchCount
    });
  }

  return { period, days, data };
}
