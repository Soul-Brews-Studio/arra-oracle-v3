import { and, desc, eq, like, sql, type SQL } from 'drizzle-orm';
import { db as defaultDb, oracleFindings } from '../../db/index.ts';
import type { ListFindingsInput, ListFindingsResult, OracleDigDb } from './types.ts';

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  const integer = Math.trunc(value!);
  return Math.min(max, Math.max(min, integer));
}

export function listFindings(input: ListFindingsInput = {}, database: OracleDigDb = defaultDb): ListFindingsResult {
  const limit = boundedInteger(input.limit, 20, 1, 100);
  const offset = boundedInteger(input.offset, 0, 0, 10_000);
  const conditions: SQL[] = [];
  const dugBy = input.dugBy ?? input.dug_by;

  if (input.subject) conditions.push(like(oracleFindings.subject, `%${input.subject}%`));
  if (input.topic) conditions.push(like(oracleFindings.topic, `%${input.topic}%`));
  if (dugBy) conditions.push(eq(oracleFindings.dugBy, dugBy));
  if (input.confidence !== undefined) conditions.push(eq(oracleFindings.confidence, input.confidence));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const countResult = database.select({ count: sql<number>`count(*)` }).from(oracleFindings).where(whereClause).get();
  const findings = database.select().from(oracleFindings)
    .where(whereClause)
    .orderBy(desc(oracleFindings.updatedAt))
    .limit(limit)
    .offset(offset)
    .all();
  const total = countResult?.count ?? 0;
  return { findings, total, hasMore: offset + findings.length < total };
}
