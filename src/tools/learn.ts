/**
 * Oracle Learn Handler
 *
 * Add new patterns/learnings to the knowledge base.
 * Exports normalizeProject and extractProjectFromSource for testability.
 */

import path from 'path';
import fs from 'fs';
import { oracleDocuments } from '../db/schema.ts';
import { detectProject } from '../server/project-detect.ts';
import { getVaultPsiRoot } from '../vault/handler.ts';
import { getVectorStoreByModel, getEmbeddingModels } from '../vector/factory.ts';
import { REPO_ROOT } from '../config.ts';

// Lazy-loaded on first use — avoids top-level await which causes a TDZ
// error in consumers that import learnToolDef synchronously (the tools
// barrel) and breaks the M5 enqueue test that imports handleLearn before
// the dynamic import resolves.
let enqueueIndexJob: ((sqlite: any, opts: any) => void) | null = null;
let enqueueLoaded = false;
async function loadEnqueue(): Promise<typeof enqueueIndexJob> {
  if (enqueueLoaded) return enqueueIndexJob;
  enqueueLoaded = true;
  try {
    enqueueIndexJob = (await import('../indexer/jobs.ts')).enqueueIndexJob;
  } catch {
    // Indexer not available — learn still works, just no async job queuing
  }
  return enqueueIndexJob;
}
import type { ToolContext, ToolResponse, OracleLearnInput } from './types.ts';

/** Coerce concepts to string[] — handles string, array, or undefined from MCP input */
export function coerceConcepts(concepts: unknown): string[] {
  if (Array.isArray(concepts)) return concepts.map(String);
  if (typeof concepts === 'string') return concepts.split(',').map(s => s.trim()).filter(Boolean);
  return [];
}

export const learnToolDef = {
  name: 'oracle_learn',
  description: 'Add a new pattern or learning to the Oracle knowledge base. Creates a markdown file in ψ/memory/learnings/ and indexes it.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'The pattern or learning to add (can be multi-line)'
      },
      source: {
        type: 'string',
        description: 'Optional source attribution (defaults to "Oracle Learn")'
      },
      concepts: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional concept tags (e.g., ["git", "safety", "trust"])'
      },
      project: {
        type: 'string',
        description: 'Source project. Accepts: "github.com/owner/repo", "owner/repo", local path with ghq/Code prefix, or GitHub URL. Auto-normalized to "github.com/owner/repo" format.'
      }
    },
    required: ['pattern']
  }
};

// ============================================================================
// Pure helper functions (exported for testing)
// ============================================================================

/**
 * Normalize project input to "github.com/owner/repo" format.
 * Accepts: github.com/owner/repo, owner/repo, GitHub URLs, local ghq paths.
 */
export function normalizeProject(input?: string): string | null {
  if (!input) return null;

  // Already normalized
  if (input.match(/^github\.com\/[^\/]+\/[^\/]+$/)) {
    return input.toLowerCase();
  }

  // GitHub URL
  const urlMatch = input.match(/https?:\/\/github\.com\/([^\/]+\/[^\/]+)/);
  if (urlMatch) return `github.com/${urlMatch[1].replace(/\.git$/, '')}`.toLowerCase();

  // Local path with github.com
  const pathMatch = input.match(/github\.com\/([^\/]+\/[^\/]+)/);
  if (pathMatch) return `github.com/${pathMatch[1]}`.toLowerCase();

  // Short format: owner/repo
  const shortMatch = input.match(/^([^\/\s]+\/[^\/\s]+)$/);
  if (shortMatch) return `github.com/${shortMatch[1]}`.toLowerCase();

  return null;
}

/**
 * Extract project from source field (fallback).
 * Handles "oracle_learn from github.com/owner/repo" and "rrr: org/repo" formats.
 */
export function extractProjectFromSource(source?: string): string | null {
  if (!source) return null;

  const oracleLearnMatch = source.match(/from\s+(github\.com\/[^\/\s]+\/[^\/\s]+)/);
  if (oracleLearnMatch) return oracleLearnMatch[1].toLowerCase();

  const rrrMatch = source.match(/^rrr:\s*([^\/\s]+\/[^\/\s]+)/);
  if (rrrMatch) return `github.com/${rrrMatch[1]}`.toLowerCase();

  const directMatch = source.match(/(github\.com\/[^\/\s]+\/[^\/\s]+)/);
  if (directMatch) return directMatch[1].toLowerCase();

  return null;
}

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
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const slug = pattern
    .substring(0, 50)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const filename = `${dateStr}_${slug}.md`;

  // Resolve vault root for central writes
  const vault = getVaultPsiRoot();
  if ('needsInit' in vault) console.error(`[Vault] ${vault.hint}`);
  const vaultRoot = 'path' in vault ? vault.path : null;

  const project = normalizeProject(projectInput)
    || extractProjectFromSource(source)
    || detectProject(ctx.repoRoot);
  const projectDir = (project || '_universal').toLowerCase();

  let filePath: string;
  let sourceFileRel: string;
  if (vaultRoot) {
    const dir = path.join(vaultRoot, projectDir, 'ψ', 'memory', 'learnings');
    fs.mkdirSync(dir, { recursive: true });
    filePath = path.join(dir, filename);
    sourceFileRel = `${projectDir}/ψ/memory/learnings/${filename}`;
  } else {
    // Write to canonical REPO_ROOT, not ctx.repoRoot (the MCP server's cwd):
    // the dashboard's /api/file resolves source_file against REPO_ROOT, so
    // writing relative to cwd produces "local file not found" (#557).
    const dir = path.join(REPO_ROOT, 'ψ/memory/learnings');
    fs.mkdirSync(dir, { recursive: true });
    filePath = path.join(dir, filename);
    sourceFileRel = `ψ/memory/learnings/${filename}`;
  }

  if (fs.existsSync(filePath)) {
    throw new Error(`File already exists: ${filename}`);
  }

  const title = pattern.split('\n')[0].substring(0, 80);
  const conceptsList = coerceConcepts(concepts);
  const frontmatter = [
    '---',
    `title: ${title}`,
    conceptsList.length > 0 ? `tags: [${conceptsList.join(', ')}]` : 'tags: []',
    `created: ${dateStr}`,
    `source: ${source || 'Oracle Learn'}`,
    ...(project ? [`project: ${project}`] : []),
    '---',
    '',
    `# ${title}`,
    '',
    pattern,
    '',
    '---',
    '*Added via Oracle Learn*',
    ''
  ].join('\n');

  fs.writeFileSync(filePath, frontmatter, 'utf-8');

  const id = `learning_${dateStr}_${slug}`;

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
    createdBy: 'oracle_learn',
  }).run();

  // FTS5 has no unique constraint on id — delete-then-insert to be idempotent.
  ctx.sqlite.prepare(`DELETE FROM oracle_fts WHERE id = ?`).run(id);
  ctx.sqlite.prepare(`
    INSERT INTO oracle_fts (id, content, concepts)
    VALUES (?, ?, ?)
  `).run(id, frontmatter, conceptsList.join(' '));

  // Vector indexing — two paths:
  //   - Default (env unset): inline embed via Ollama. Keeps DB + lancedb in
  //     step so oracle_search hybrid mode works immediately. Graceful fallback
  //     on embedder failure — FTS row above is still searchable.
  //   - ORACLE_INDEXER_ENQUEUE=1 (M5 of indexer-CLI): queue a row in
  //     indexing_jobs for the daemon to embed asynchronously. FTS-first /
  //     vector-later. Never blocks ingest. Architecture:
  //     ψ/lab/indexer-cli/DESIGN.md.
  let embeddingStatus: 'ok' | 'skipped' | 'failed' | 'enqueued' = 'skipped';
  const enqueue = process.env.ORACLE_INDEXER_ENQUEUE === '1' ? await loadEnqueue() : null;
  if (enqueue) {
    try {
      enqueue(ctx.sqlite, { docId: id, models: getEmbeddingModels() });
      embeddingStatus = 'enqueued';
    } catch (err) {
      // Never block ingest on the queue — same posture as the inline path.
      embeddingStatus = 'failed';
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
        message: `Pattern added to Oracle knowledge base${vaultRoot ? ' (vault)' : ''}${embeddingStatus === 'failed' ? ' — vector embedding failed, see server log' : ''}`
      }, null, 2)
    }]
  };
}
