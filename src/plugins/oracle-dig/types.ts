import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import type * as schema from '../../db/schema.ts';
import type { oracleFindingEvidence, oracleFindings } from '../../db/schema.ts';

export type OracleDigDb = BunSQLiteDatabase<typeof schema>;

export type Finding = typeof oracleFindings.$inferSelect;
export type NewFinding = typeof oracleFindings.$inferInsert;
export type Evidence = typeof oracleFindingEvidence.$inferSelect;
export type NewEvidence = typeof oracleFindingEvidence.$inferInsert;
export type EvidenceKind = Evidence['kind'];

export type InsertFindingInput = Omit<NewFinding, 'id' | 'createdAt' | 'updatedAt'>
  & Partial<Pick<NewFinding, 'id' | 'createdAt' | 'updatedAt'>>;

export type InsertEvidenceInput = Omit<NewEvidence, 'id' | 'createdAt'>
  & Partial<Pick<NewEvidence, 'createdAt'>>;

export type ListFindingsInput = {
  subject?: string;
  topic?: string;
  dugBy?: string;
  dug_by?: string;
  confidence?: number;
  limit?: number;
  offset?: number;
};

export type ListFindingsResult = {
  findings: Finding[];
  total: number;
  hasMore: boolean;
};

export type FindingWithEvidence = Finding & { evidence: Evidence[] };
