import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { db as defaultDb, oracleFindingEvidence, oracleFindings } from '../../db/index.ts';
import type { Evidence, Finding, InsertEvidenceInput, InsertFindingInput, OracleDigDb } from './types.ts';

function requiredText(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function finiteNumber(value: number | undefined, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} is required`);
  return value!;
}

export function insertFinding(input: InsertFindingInput, database: OracleDigDb = defaultDb): Finding {
  const now = Date.now();
  const id = input.id ?? randomUUID();
  database.insert(oracleFindings).values({
    id,
    tenantId: input.tenantId ?? 'default',
    subject: requiredText(input.subject, 'subject'),
    relation: input.relation ?? null,
    object: input.object ?? null,
    dugBy: requiredText(input.dugBy, 'dugBy'),
    asOfTs: finiteNumber(input.asOfTs, 'asOfTs'),
    asOfCommit: input.asOfCommit ?? null,
    confidence: finiteNumber(input.confidence, 'confidence'),
    topic: input.topic ?? null,
    frictionScore: input.frictionScore ?? null,
    commissionedBy: input.commissionedBy ?? null,
    iterations: input.iterations ?? 1,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  }).run();
  const row = database.select().from(oracleFindings).where(eq(oracleFindings.id, id)).get();
  if (!row) throw new Error(`Failed to insert finding: ${id}`);
  return row;
}

export function insertEvidence(input: InsertEvidenceInput, database: OracleDigDb = defaultDb): Evidence {
  const result = database.insert(oracleFindingEvidence).values({
    findingId: requiredText(input.findingId, 'findingId'),
    tenantId: input.tenantId ?? 'default',
    kind: input.kind,
    githubOwner: input.githubOwner ?? null,
    githubRepo: input.githubRepo ?? null,
    githubPath: input.githubPath ?? null,
    githubRef: input.githubRef ?? null,
    githubLine: input.githubLine ?? null,
    sessionId: input.sessionId ?? null,
    sessionOracle: input.sessionOracle ?? null,
    oracleMsgFrom: input.oracleMsgFrom ?? null,
    oracleMsgAt: input.oracleMsgAt ?? null,
    webUrl: input.webUrl ?? null,
    webFetchedAt: input.webFetchedAt ?? null,
    commit: input.commit ?? null,
    createdAt: input.createdAt ?? Date.now(),
  }).run() as unknown as { lastInsertRowid?: number | bigint };
  const id = Number(result.lastInsertRowid);
  const row = Number.isFinite(id)
    ? database.select().from(oracleFindingEvidence).where(eq(oracleFindingEvidence.id, id)).get()
    : null;
  if (!row) throw new Error('Failed to insert finding evidence');
  return row;
}
