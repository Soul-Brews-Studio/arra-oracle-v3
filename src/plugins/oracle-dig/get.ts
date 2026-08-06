import { asc, eq } from 'drizzle-orm';
import { db as defaultDb, oracleFindingEvidence, oracleFindings } from '../../db/index.ts';
import type { FindingWithEvidence, OracleDigDb } from './types.ts';

export function getFinding(id: string, database: OracleDigDb = defaultDb): FindingWithEvidence | null {
  const finding = database.select().from(oracleFindings).where(eq(oracleFindings.id, id)).get();
  if (!finding) return null;
  const evidence = database.select().from(oracleFindingEvidence)
    .where(eq(oracleFindingEvidence.findingId, id))
    .orderBy(asc(oracleFindingEvidence.id))
    .all();
  return { ...finding, evidence };
}
