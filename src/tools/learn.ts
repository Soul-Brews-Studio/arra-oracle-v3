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
import type { ToolContext, ToolResponse, OracleLearnInput } from './types.ts';
// import { getDeduplicator, type DedupDecision } from './deduplication.ts';  // TEMPORARILY DISABLED

/** Coerce concepts to string[] — handles string, array, or undefined from MCP input */
export function coerceConcepts(concepts: unknown): string[] {
  if (Array.isArray(concepts)) return concepts.map(String);
  if (typeof concepts === 'string') return concepts.split(',').map(s => s.trim()).filter(Boolean);
  return [];
}

export const learnToolDef = {
  name: 'arra_learn',
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
 * Handles "arra_learn from github.com/owner/repo" and "rrr: org/repo" formats.
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
  const { pattern, source, concepts, project: projectInput } = input;
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];

  // ============================================================================
  // Memory Deduplication Check (mem0-inspired) - TEMPORARILY DISABLED FOR DEBUGGING
  // ============================================================================
  // const dedup = getDeduplicator();
  // const dedupResult = await dedup.checkDuplicates(ctx, pattern);

  // Handle deduplication decisions
  // if (dedupResult.decision === 'SKIP') {
  //   console.log(`[Dedup] Skipping duplicate learning: ${dedupResult.reasoning}`);

  //   return {
  //     content: [{
  //       type: 'text',
  //       text: JSON.stringify({
  //         success: true,
  //         skipped: true,
  //         decision: 'SKIP',
  //         reasoning: dedupResult.reasoning,
  //         similarTo: dedupResult.similarLearning?.id,
  //         message: `Learning skipped (duplicate): ${dedupResult.reasoning}`
  //       }, null, 2)
  //     }]
  //   };
  // }

  // if (dedupResult.decision === 'UPDATE' || dedupResult.decision === 'ENHANCE') {
  //   console.log(`[Dedup] ${dedupResult.decision} decision: ${dedupResult.reasoning}`);

  //   // For now, still proceed with adding new learning
  //   // TODO: Implement actual UPDATE/ENHANCE logic (merge with existing)
  //   // Future: Could append to existing file or create linked learning
  // }

  // ============================================================================
  // Proceed with adding learning
  // ============================================================================

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
    const dir = path.join(ctx.repoRoot, 'ψ/memory/learnings');
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

  console.log('[DEBUG] About to INSERT into oracle_documents...');
  try {
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
      createdBy: 'arra_learn',
    }).run();
    console.log('[DEBUG] oracle_documents INSERT succeeded');
  } catch (err) {
    console.error('[DEBUG] oracle_documents INSERT failed:', err);
    throw err;
  }

  console.log('[DEBUG] About to INSERT into oracle_fts...');
  try {
    ctx.sqlite.prepare(`
      INSERT INTO oracle_fts (id, content, concepts)
      VALUES (?, ?, ?)
    `).run(id, frontmatter, conceptsList.join(' '));
    console.log('[DEBUG] oracle_fts INSERT succeeded');
  } catch (err) {
    console.error('[DEBUG] oracle_fts INSERT failed:', err);
    throw err;
  }

  // ============================================================================
  // Add to ChromaDB for semantic search (mem0-inspired)
  // ============================================================================
  try {
    await ctx.vectorStore.ensureCollection();

    // Build metadata (exclude null values for ChromaDB compatibility)
    const metadata: Record<string, string | number> = {
      id,
      type: 'learning',
      source_file: sourceFileRel,
      concepts: JSON.stringify(conceptsList),
      created: dateStr,
      source: source || 'Oracle Learn',
      title,
    };
    if (project) {
      metadata.project = project;
    }

    await ctx.vectorStore.addDocuments([{
      id,
      document: pattern,
      metadata,
    }]);
    console.error(`[ChromaDB] Added learning: ${id}`);
  } catch (error) {
    // Non-fatal: log error but don't fail the learning operation
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[ChromaDB] Failed to add learning: ${errorMsg}`);
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        file: sourceFileRel,
        id,
        decision: 'ADD',
        dedupReasoning: 'Deduplication temporarily disabled for debugging',
        message: `Pattern added to Oracle knowledge base${vaultRoot ? ' (vault)' : ''}`
      }, null, 2)
    }]
  };
}
