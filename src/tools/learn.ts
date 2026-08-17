/**
 * Oracle Learn Handler
 *
 * Add new patterns/learnings to the knowledge base.
 * Exports normalizeProject and extractProjectFromSource for testability.
 */

import path from 'path';
import fs from 'fs';
import { learnLog, oracleDocuments } from '../db/schema.ts';
import { detectProject } from '../server/project-detect.ts';
import { tenantIdForWrite } from '../middleware/tenant.ts';
import { getVectorStoreByModel, getEmbeddingModels } from '../vector/factory.ts';
import { REPO_ROOT } from '../config.ts';
import { buildLearningMarkdown, dateSlug, learningSlug, uniqueTail } from '../learn/markdown.ts';
import { findDuplicateLearning } from '../learn/dedup.ts';
import {
  coerceConcepts,
  errorDetails,
  extractProjectFromSource,
  loadEnqueue,
  loadGetVaultPsiRoot,
  normalizeProject,
} from './learn-support.ts';
import type { ToolContext, ToolResponse, OracleLearnInput } from './types.ts';
export { coerceConcepts, errorDetails, extractProjectFromSource, learnToolDef, normalizeProject } from './learn-support.ts';

// ============================================================================
// Handler
// ============================================================================

export async function handleLearn(ctx: ToolContext, input: OracleLearnInput): Promise<ToolResponse> {
  // Null-guard: MCP clients sometimes call with no args. Show usage instead of crashing.
  if (input == null || typeof input !== 'object') {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: "arra_learn requires field 'pattern' (non-empty string).",
          usage: "arra_learn({ pattern: 'your learning or pattern...', concepts?: ['tag1','tag2'], project?: 'github.com/owner/repo', source?: 'optional source' })",
          tip: "Search for similar topics first with arra_search, and use arra_supersede if updating older info."
        }, null, 2)
      }],
      isError: true
    };
  }

  const { pattern, source, concepts, project: projectInput } = input;

  // Validate pattern: must be a non-empty string before any string ops or filename derivation.
  // (Cast through `unknown` so the runtime check survives even when callers pass undefined despite TS typing.)
  if (typeof (pattern as unknown) !== 'string' || (pattern as string).trim().length === 0) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: "arra_learn requires field 'pattern' (non-empty string).",
          received: pattern === undefined ? 'undefined' : typeof pattern,
          usage: "arra_learn({ pattern: 'your learning or pattern...', concepts?: ['tag1','tag2'] })",
          tip: "Empty pattern would produce a corrupt filename; reject upfront."
        }, null, 2)
      }],
      isError: true
    };
  }

  const now = new Date();
  const dateStr = dateSlug(now);

  // Was an inline copy of the slug logic WITHOUT learningSlug's `|| 'learning'`
  // fallback. The regex strips everything outside [a-z0-9\s-], so a wholly
  // non-ASCII pattern — Thai, Japanese, Cyrillic — slugged to the empty string,
  // the file became `<date>_.md`, and the SECOND such learning on the same day
  // hit the "File already exists" throw below. The caller is an AI that does not
  // retry, so the learning was silently lost. See #2819.
  const slug = learningSlug(pattern);

  const project = normalizeProject(projectInput)
    || extractProjectFromSource(source)
    || detectProject(ctx.repoRoot);
  const tenantId = tenantIdForWrite();
  // Resolve the optional vault before the gate so no async yield can split the
  // gate from the synchronous file/SQLite write in this process.
  const getVaultPsiRoot = await loadGetVaultPsiRoot();
  const vault = getVaultPsiRoot();
  if ('needsInit' in vault) console.error(`[Vault] ${vault.hint}`);
  const vaultRoot = 'path' in vault ? vault.path : null;

  const duplicate = findDuplicateLearning(ctx.sqlite, { pattern, tenantId, project });
  if (duplicate) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          duplicate: true,
          file: duplicate.sourceFile,
          id: duplicate.id,
          embedding: 'skipped',
          message: 'Matching active learning already exists; no duplicate was written',
        }, null, 2),
      }],
    };
  }

  const projectDir = (project || '_universal').toLowerCase();

  const dir = vaultRoot
    ? path.join(vaultRoot, projectDir, 'ψ', 'memory', 'learnings')
    // Write to canonical REPO_ROOT, not ctx.repoRoot (the MCP server's cwd):
    // the dashboard's /api/file resolves source_file against REPO_ROOT, so
    // writing relative to cwd produces "local file not found" (#557).
    : path.join(REPO_ROOT, 'ψ/memory/learnings');
  fs.mkdirSync(dir, { recursive: true });

  // Suffix instead of throwing. Two learnings a day sharing a slug is ordinary —
  // and now guaranteed for non-ASCII patterns, which all fall back to the same
  // 'learning' slug. Throwing loses the second one because the caller is an AI
  // that does not retry. Mirrors routes/learn/crud.ts:78-107. (#2819)
  const tail = uniqueTail(dir, dateStr, slug);
  const filename = `${dateStr}_${tail}.md`;
  const filePath = path.join(dir, filename);
  const sourceFileRel = vaultRoot
    ? `${projectDir}/ψ/memory/learnings/${filename}`
    : `ψ/memory/learnings/${filename}`;

  const id = `learning_${dateStr}_${tail}`;
  const title = pattern.split('\n')[0].substring(0, 80);
  const conceptsList = coerceConcepts(concepts);
  const frontmatter = buildLearningMarkdown({
    id,
    pattern,
    title,
    concepts: conceptsList,
    createdAt: now,
    source,
    project,
  });

  fs.writeFileSync(filePath, frontmatter, 'utf-8');

  ctx.db.insert(oracleDocuments).values({
    id,
    type: 'learning',
    sourceFile: sourceFileRel,
    concepts: JSON.stringify(conceptsList),
    createdAt: now.getTime(),
    updatedAt: now.getTime(),
    indexedAt: now.getTime(),
    origin: null,
    project,
    tenantId,
    createdBy: 'oracle_learn',
  }).run();

  // FTS5 has no unique constraint on id — delete-then-insert to be idempotent.
  ctx.sqlite.prepare(`DELETE FROM oracle_fts WHERE id = ?`).run(id);
  ctx.sqlite.prepare(`
    INSERT INTO oracle_fts (id, content, concepts)
    VALUES (?, ?, ?)
  `).run(id, frontmatter, conceptsList.join(' '));

  // Keep Studio Activity aligned with the MCP write path. This mirrors the
  // legacy handleLearn/logLearning fields while using the injected DB context.
  try {
    ctx.db.insert(learnLog).values({
      documentId: id,
      patternPreview: pattern.substring(0, 100),
      source: source || 'Oracle Learn',
      concepts: JSON.stringify(conceptsList),
      createdAt: now.getTime(),
      tenantId,
      project,
    }).run();
  } catch (error) {
    console.error('Failed to log learning:', error);
  }

  // Vector indexing — two paths:
  //   - Default (env unset): inline embed via Ollama. Keeps DB + lancedb in
  //     step so oracle_search hybrid mode works immediately. Graceful fallback
  //     on embedder failure — FTS row above is still searchable.
  //   - ORACLE_INDEXER_ENQUEUE=1 (M5 of indexer-CLI): queue a row in
  //     indexing_jobs for the daemon to embed asynchronously. FTS-first /
  //     vector-later. Never blocks ingest. Architecture:
  //     ψ/lab/indexer-cli/DESIGN.md.
  let embeddingStatus: 'ok' | 'skipped' | 'failed' | 'enqueued' = 'skipped';
  let embeddingError: ReturnType<typeof errorDetails> | undefined;
  const enqueue = process.env.ORACLE_INDEXER_ENQUEUE === '1' ? await loadEnqueue() : null;
  if (enqueue) {
    try {
      enqueue(ctx.sqlite, { docId: id, models: getEmbeddingModels() });
      embeddingStatus = 'enqueued';
    } catch (err) {
      // Never block ingest on the queue — same posture as the inline path.
      embeddingStatus = 'failed';
      embeddingError = errorDetails(err);
      console.warn(`[oracle_learn] enqueue failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    try {
      const model = process.env.ORACLE_EMBEDDING_MODEL || 'bge-m3';
      const vectorStore = getVectorStoreByModel(model);
      await vectorStore.addDocuments([{
        id,
        document: frontmatter,
        metadata: {
          type: 'learning',
          source_file: sourceFileRel,
          project: project || '',
          concepts: conceptsList.join(','),
        },
      }]);
      embeddingStatus = 'ok';
    } catch (err) {
      embeddingStatus = 'failed';
      embeddingError = errorDetails(err);
      console.warn(`[oracle_learn] vector embedding failed for ${id}: ${err instanceof Error ? err.message : String(err)}`);
      console.warn(`[oracle_learn] document still searchable via FTS5; run 'bun src/scripts/index-model.ts <model>' later to backfill vectors`);
    }
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        file: sourceFileRel,
        id,
        embedding: embeddingStatus,
        ...(embeddingError && { embeddingError }),
        message: `Pattern added to Oracle knowledge base${vaultRoot ? ' (vault)' : ''}${embeddingStatus === 'failed' ? ' — vector embedding failed, see server log' : ''}`
      }, null, 2)
    }]
  };
}
