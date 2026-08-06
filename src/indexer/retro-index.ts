/**
 * Retrospective-only indexing for local oracle ψ/ directories.
 *
 * Full reindex uses a canonical repoRoot and smart-delete. That is correct for
 * aggregate vault indexing, but it is too blunt for `/rrr`-style local retro
 * writes: a single oracle can write a fresh markdown file under its own
 * `ψ/memory/retrospectives/` while the live DB was originally built from an
 * older aggregate vault. This path mirrors oracle_learn's write-time behavior:
 * parse the local file(s), upsert SQLite + FTS rows, and do not smart-delete
 * unrelated historical docs.
 */

import fs from 'fs';
import path from 'path';
import { createDatabase } from '../db/index.ts';
import { DB_PATH } from '../config.ts';
import { detectProject } from '../server/project-detect.ts';
import { collectDocuments } from './collectors.ts';
import { parseRetroFile } from './parser.ts';
import { storeDocuments } from './storage.ts';

export async function indexRetrospectives(repoRoot: string) {
  const resolvedRoot = path.resolve(repoRoot);
  const seenContentHashes = new Set<string>();
  const documents = collectDocuments({
    config: {
      repoRoot: resolvedRoot,
      dbPath: DB_PATH,
      chromaPath: '',
      sourcePaths: {
        resonance: 'ψ/memory/resonance',
        learnings: 'ψ/memory/learnings',
        retrospectives: 'ψ/memory/retrospectives',
        distillations: 'ψ/memory/distillations',
        learn: 'ψ/learn',
      },
    },
    seenContentHashes,
    subdir: 'retrospectives',
    parseFn: parseRetroFile,
    label: 'retrospective',
  });

  const { sqlite, db } = createDatabase(DB_PATH);
  try {
    await storeDocuments(sqlite, db, null, detectProject(resolvedRoot), documents, {
      createdBy: 'retro_indexer',
    });
  } finally {
    sqlite.close();
  }

  return { ok: true as const, repoRoot: resolvedRoot, documents: documents.length };
}

export async function indexRetroFile(repoRoot: string, filePath: string) {
  const resolvedRoot = path.resolve(repoRoot);
  const resolvedFile = path.resolve(filePath);
  const retroRoot = path.join(resolvedRoot, 'ψ', 'memory', 'retrospectives');

  if (!resolvedFile.startsWith(retroRoot + path.sep)) {
    throw new Error(`Refusing to index non-retro file outside ${retroRoot}: ${resolvedFile}`);
  }
  if (!fs.existsSync(resolvedFile)) {
    throw new Error(`Retrospective file not found: ${resolvedFile}`);
  }

  const relPath = path.relative(resolvedRoot, resolvedFile);
  const content = fs.readFileSync(resolvedFile, 'utf-8');
  const documents = parseRetroFile(relPath, content);
  const { sqlite, db } = createDatabase(DB_PATH);
  try {
    await storeDocuments(sqlite, db, null, detectProject(resolvedRoot), documents, {
      createdBy: 'retro_indexer',
    });
  } finally {
    sqlite.close();
  }

  return { ok: true as const, repoRoot: resolvedRoot, filePath: resolvedFile, documents: documents.length };
}
