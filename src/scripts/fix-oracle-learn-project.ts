/**
 * Fix missing project field for oracle_learn documents
 * Uses Drizzle ORM - not direct SQL!
 */

import { db, sqlite } from '../db/index.ts';
import { oracleDocuments } from '../db/schema.ts';
import { eq, isNull, or, and } from 'drizzle-orm';
import { homedir } from 'os';
import path from 'path';
import fs from 'fs';

const REPO_ROOT = path.join(homedir(), 'Code/github.com/Soul-Brews-Studio/oracle-v2');

// Find all oracle_learn docs without project using Drizzle
const docs = db.select({
  id: oracleDocuments.id,
  sourceFile: oracleDocuments.sourceFile
})
  .from(oracleDocuments)
  .where(
    and(
      eq(oracleDocuments.createdBy, 'oracle_learn'),
      or(isNull(oracleDocuments.project), eq(oracleDocuments.project, ''))
    )
  )
  .all();

console.log(`Found ${docs.length} oracle_learn docs without project`);

let fixed = 0;
let fixedFromFts = 0;
let failed = 0;

for (const doc of docs) {
  try {
    let project: string | null = null;

    // Method 1: Try to read local file
    if (doc.sourceFile) {
      const fullPath = path.join(REPO_ROOT, doc.sourceFile);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        project = extractProjectFromSource(content);
      }
    }

    // Method 2: Try FTS content if file not found
    if (!project) {
      const ftsResult = sqlite.prepare(
        'SELECT content FROM oracle_fts WHERE id = ?'
      ).get(doc.id) as { content: string } | undefined;

      if (ftsResult?.content) {
        project = extractProjectFromSource(ftsResult.content);
        if (project) fixedFromFts++;
      }
    }

    if (project) {
      // Update using Drizzle
      db.update(oracleDocuments)
        .set({ project })
        .where(eq(oracleDocuments.id, doc.id))
        .run();

      console.log(`✓ Fixed ${doc.id} → ${project}`);
      fixed++;
    } else {
      console.log(`✗ Cannot fix ${doc.id} - no source found`);
      failed++;
    }
  } catch (e) {
    console.log(`✗ Error fixing ${doc.id}:`, e);
    failed++;
  }
}

console.log(`\nDone: ${fixed} fixed (${fixedFromFts} from FTS), ${failed} could not be fixed`);

/**
 * Extract project from source field in frontmatter
 * Handles formats:
 * - "oracle_learn from github.com/owner/repo"
 * - "rrr: org/repo" or "rrr: Owner/Repo"
 * - "source: github.com/owner/repo"
 */
function extractProjectFromSource(content: string): string | null {
  // Try "oracle_learn from github.com/owner/repo"
  const oracleLearnMatch = content.match(/from\s+(github\.com\/[^\/\s]+\/[^\/\s]+)/);
  if (oracleLearnMatch) return oracleLearnMatch[1];

  // Try "rrr: org/repo" format (convert to github.com/org/repo)
  const rrrMatch = content.match(/source:\s*rrr:\s*([^\/\s]+\/[^\/\s\n]+)/);
  if (rrrMatch) return `github.com/${rrrMatch[1]}`;

  // Try direct "source: github.com/owner/repo"
  const directMatch = content.match(/source:\s*(github\.com\/[^\/\s]+\/[^\/\s\n]+)/);
  if (directMatch) return directMatch[1];

  return null;
}
