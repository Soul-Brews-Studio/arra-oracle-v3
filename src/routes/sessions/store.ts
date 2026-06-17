import fs from 'fs';
import path from 'path';
import { eq } from 'drizzle-orm';
import { REPO_ROOT } from '../../config.ts';
import { db, oracleDocuments, sqlite } from '../../db/index.ts';
import { buildLearningMarkdown } from '../../learn/markdown.ts';
import { DEFAULT_TENANT_ID, tenantIdForWrite } from '../../middleware/tenant.ts';
import { logLearning } from '../../server/logging.ts';
import { MAX_SUMMARY_CHARS } from './model.ts';

const SUMMARY_ROOT = 'ψ/memory/session-summaries';

function repoRoot(): string {
  return process.env.ORACLE_REPO_ROOT || REPO_ROOT;
}

function safeSegment(value: string, limit: number): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-');
  return normalized.slice(0, limit).replace(/^[._-]+|[._-]+$/g, '');
}

function summaryIdentity(sessionId: string, tenantId: string): { id: string; filename: string; sourceFile: string } {
  const safeSession = safeSegment(sessionId, 120);
  if (!safeSession) throw new Error('Invalid session id');
  if (tenantId === DEFAULT_TENANT_ID) {
    return {
      id: `session-summary_${safeSession}`,
      filename: `${safeSession}.md`,
      sourceFile: `${SUMMARY_ROOT}/${safeSession}.md`,
    };
  }

  const tenantSegment = safeSegment(tenantId, 80) || DEFAULT_TENANT_ID;
  return {
    id: `session-summary_${tenantSegment}_${safeSession}`,
    filename: `${safeSession}.md`,
    sourceFile: `${SUMMARY_ROOT}/${tenantSegment}/${safeSession}.md`,
  };
}

function cleanSummary(summary: string): string {
  const trimmed = summary.trim();
  if (!trimmed) throw new Error('Invalid summary');
  if (trimmed.length > MAX_SUMMARY_CHARS) throw new Error('Summary too long');
  return trimmed;
}

function firstSummaryLine(summary: string, fallback: string): string {
  return summary.split('\n').map((line) => line.trim()).find(Boolean)?.substring(0, 80)
    || `Session summary ${fallback}`.substring(0, 80);
}

export function persistSessionSummary(
  sessionId: string,
  summary: string,
  oracle?: string,
): { ok: true; source_file: string; learning_id: string; tenant_id: string } {
  const tenantId = tenantIdForWrite();
  const identity = summaryIdentity(sessionId, tenantId);
  const now = new Date();
  const safeSession = safeSegment(sessionId, 120);
  const cleanPattern = cleanSummary(summary);
  const cleanOracle = oracle?.trim();
  const concepts = ['session-summary', `session-${safeSession}`];
  if (cleanOracle) {
    const safeOracle = safeSegment(cleanOracle, 80);
    if (safeOracle) concepts.push(`oracle-${safeOracle}`);
  }

  const title = firstSummaryLine(cleanPattern, safeSession);
  const source = cleanOracle ? `session-summary from ${cleanOracle}` : 'session-summary';
  const content = buildLearningMarkdown({
    id: identity.id,
    pattern: cleanPattern,
    title,
    concepts,
    createdAt: now,
    source,
    footer: '*Added via session auto-summary*',
  });

  const filePath = path.join(repoRoot(), identity.sourceFile);
  const existing = db.select({ id: oracleDocuments.id }).from(oracleDocuments)
    .where(eq(oracleDocuments.id, identity.id)).get();
  if (existing) throw new Error(`File already exists: ${identity.filename}`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath)) throw new Error(`File already exists: ${identity.filename}`);
  fs.writeFileSync(filePath, content, 'utf-8');

  db.insert(oracleDocuments).values({
    id: identity.id,
    tenantId,
    type: 'learning',
    sourceFile: identity.sourceFile,
    concepts: JSON.stringify(concepts),
    createdAt: now.getTime(),
    updatedAt: now.getTime(),
    indexedAt: now.getTime(),
    createdBy: 'session_summary',
  }).run();

  sqlite.prepare('DELETE FROM oracle_fts WHERE id = ?').run(identity.id);
  sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)')
    .run(identity.id, content, concepts.join(' '));
  logLearning(identity.id, cleanPattern, source, concepts);

  return { ok: true, source_file: identity.sourceFile, learning_id: identity.id, tenant_id: tenantId };
}
