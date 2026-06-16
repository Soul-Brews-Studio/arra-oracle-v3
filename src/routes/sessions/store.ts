import fs from 'fs';
import path from 'path';
import { REPO_ROOT } from '../../config.ts';
import { db, oracleDocuments, sqlite } from '../../db/index.ts';
import { buildLearningMarkdown } from '../../learn/markdown.ts';
import { activeTenantId, DEFAULT_TENANT_ID, tenantIdForWrite } from '../../middleware/tenant.ts';
import { logLearning } from '../../server/logging.ts';

const SUMMARY_ROOT = 'ψ/memory/session-summaries';

function repoRoot(): string {
  return process.env.ORACLE_REPO_ROOT || REPO_ROOT;
}

function safeSegment(value: string, limit: number): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, limit);
}

function summaryIdentity(sessionId: string): { id: string; filename: string; sourceFile: string } {
  const safeSession = safeSegment(sessionId, 120);
  if (!safeSession) throw new Error('Invalid session id');

  const tenantId = activeTenantId();
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

export function persistSessionSummary(
  sessionId: string,
  summary: string,
  oracle?: string,
): { ok: true; source_file: string; learning_id: string } {
  const identity = summaryIdentity(sessionId);
  const now = new Date();
  const safeSession = safeSegment(sessionId, 120);
  const concepts = ['session-summary', `session-${safeSession}`];
  if (oracle) {
    const safeOracle = safeSegment(oracle, 80);
    if (safeOracle) concepts.push(`oracle-${safeOracle}`);
  }

  const title = summary.split('\n')[0].substring(0, 80);
  const content = buildLearningMarkdown({
    id: identity.id,
    pattern: summary,
    title,
    concepts,
    createdAt: now,
    source: oracle ? `session-summary from ${oracle}` : 'session-summary',
    footer: '*Added via session auto-summary*',
  });

  const filePath = path.join(repoRoot(), identity.sourceFile);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath)) throw new Error(`File already exists: ${identity.filename}`);
  fs.writeFileSync(filePath, content, 'utf-8');

  db.insert(oracleDocuments).values({
    id: identity.id,
    tenantId: tenantIdForWrite(),
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
  logLearning(identity.id, summary, oracle ? `session-summary from ${oracle}` : 'session-summary', concepts);

  return { ok: true, source_file: identity.sourceFile, learning_id: identity.id };
}
