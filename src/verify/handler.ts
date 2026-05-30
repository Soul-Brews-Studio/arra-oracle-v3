/**
 * Oracle Verify Handler
 *
 * Compares ψ/ files on disk vs DB index.
 * Detects: healthy, missing, orphaned, drifted, untracked files.
 *
 * Philosophy: "Nothing is Deleted" — orphans are flagged, not removed.
 */

import fs from 'fs';
import path from 'path';
import { eq } from 'drizzle-orm';
import { db, oracleDocuments } from '../db/index.ts';

export interface VerifyResult {
  counts: {
    healthy: number;
    missing: number;
    orphaned: number;
    drifted: number;
    untracked: number;
  };
  missing: string[];
  orphaned: string[];
  drifted: string[];
  untracked: string[];
  recommendation: string;
  fixedOrphans?: number;
}

interface FileInfo {
  relativePath: string;
  mtimeMs: number;
}

/**
 * Recursively collect all .md files with mtimes
 */
function walkMarkdownFiles(dir: string, baseDir: string): FileInfo[] {
  const files: FileInfo[] = [];
  if (!fs.existsSync(dir)) return files;

  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...walkMarkdownFiles(fullPath, baseDir));
    } else if (item.endsWith('.md')) {
      files.push({
        relativePath: path.relative(baseDir, fullPath),
        mtimeMs: stat.mtimeMs,
      });
    }
  }
  return files;
}

/**
 * Verify knowledge base integrity: disk files vs DB index
 */
export function verifyKnowledgeBase(opts: {
  check?: boolean;
  type?: string;
  repoRoot: string;
}): VerifyResult {
  const { check = true, type, repoRoot } = opts;

  // 1. Walk indexed directories on disk
  const indexedDirs = ['ψ/memory/resonance', 'ψ/memory/learnings', 'ψ/memory/retrospectives'];
  const diskFiles = new Map<string, number>(); // relativePath -> mtimeMs

  for (const dir of indexedDirs) {
    const fullDir = path.join(repoRoot, dir);
    const files = walkMarkdownFiles(fullDir, repoRoot);
    for (const f of files) {
      diskFiles.set(f.relativePath, f.mtimeMs);
    }
  }

  // 2. Query DB for all indexed documents
  const typeFilter = type && type !== 'all' ? type : undefined;
  const dbRows = typeFilter
    ? db.select({
        id: oracleDocuments.id,
        sourceFile: oracleDocuments.sourceFile,
        indexedAt: oracleDocuments.indexedAt,
        type: oracleDocuments.type,
      })
        .from(oracleDocuments)
        .where(eq(oracleDocuments.type, typeFilter))
        .all()
    : db.select({
        id: oracleDocuments.id,
        sourceFile: oracleDocuments.sourceFile,
        indexedAt: oracleDocuments.indexedAt,
        type: oracleDocuments.type,
      })
        .from(oracleDocuments)
        .all();

  // Build map: sourceFile -> { indexedAt, ids[] }
  // Multiple DB entries can point to the same source file (chunked docs)
  const dbFileMap = new Map<string, { indexedAt: number; ids: string[] }>();
  for (const row of dbRows) {
    const existing = dbFileMap.get(row.sourceFile);
    if (existing) {
      existing.ids.push(row.id);
      // Use the latest indexedAt
      if (row.indexedAt > existing.indexedAt) {
        existing.indexedAt = row.indexedAt;
      }
    } else {
      dbFileMap.set(row.sourceFile, { indexedAt: row.indexedAt, ids: [row.id] });
    }
  }

  // 3. Classify
  const healthy: string[] = [];
  const missing: string[] = [];
  const drifted: string[] = [];
  const orphaned: string[] = [];

  // Check each file on disk
  for (const [relPath, mtimeMs] of diskFiles) {
    const dbEntry = dbFileMap.get(relPath);
    if (!dbEntry) {
      // File on disk, not in DB
      missing.push(relPath);
    } else {
      // File exists in both — check drift
      if (mtimeMs > dbEntry.indexedAt) {
        drifted.push(relPath);
      } else {
        healthy.push(relPath);
      }
    }
  }

  // Check each DB entry for orphans (in DB, not on disk)
  const seenDbFiles = new Set<string>();
  for (const [sourceFile] of dbFileMap) {
    if (seenDbFiles.has(sourceFile)) continue;
    seenDbFiles.add(sourceFile);

    if (!diskFiles.has(sourceFile)) {
      orphaned.push(sourceFile);
    }
  }

  // 4. Count untracked files (ψ/inbox/, ψ/learn/, etc. — outside indexed dirs)
  const untrackedDirs = ['ψ/inbox'];
  const untracked: string[] = [];
  for (const dir of untrackedDirs) {
    const fullDir = path.join(repoRoot, dir);
    const files = walkMarkdownFiles(fullDir, repoRoot);
    for (const f of files) {
      untracked.push(f.relativePath);
    }
  }

  // 5. Auto-fix orphans if check=false
  let fixedOrphans = 0;
  if (!check && orphaned.length > 0) {
    const now = Date.now();
    for (const sourceFile of orphaned) {
      const entry = dbFileMap.get(sourceFile);
      if (entry) {
        for (const id of entry.ids) {
          db.update(oracleDocuments)
            .set({
              supersededBy: '_verified_orphan',
              supersededAt: now,
              supersededReason: 'File missing from disk (oracle_verify)',
            })
            .where(eq(oracleDocuments.id, id))
            .run();
          fixedOrphans++;
        }
      }
    }
  }

  // 6. Build recommendation
  const issues = missing.length + orphaned.length + drifted.length;
  let recommendation = '';
  if (issues === 0) {
    recommendation = 'Knowledge base is healthy. All files match DB index.';
  } else {
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`${missing.length} missing from index`);
    if (orphaned.length > 0) parts.push(`${orphaned.length} orphaned in DB`);
    if (drifted.length > 0) parts.push(`${drifted.length} drifted since last index`);
    recommendation = `Run \`bun run index\` to fix ${issues} issues (${parts.join(', ')})`;
  }

  if (fixedOrphans > 0) {
    recommendation += `. Flagged ${fixedOrphans} orphaned entries as '_verified_orphan'.`;
  }

  return {
    counts: {
      healthy: healthy.length,
      missing: missing.length,
      orphaned: orphaned.length,
      drifted: drifted.length,
      untracked: untracked.length,
    },
    missing,
    orphaned,
    drifted,
    untracked,
    recommendation,
    ...(fixedOrphans > 0 ? { fixedOrphans } : {}),
  };
}
