/**
 * Oracle v2 Indexer
 *
 * Parses markdown files from psi/memory and creates:
 * 1. SQLite index (source of truth for metadata)
 * 2. FTS5 full-text index
 *
 * Vector indexing (LanceDB) is handled separately by src/scripts/index-model.ts
 * to keep a single source of truth for the canonical LanceDB path + collection
 * (via the EMBEDDING_MODELS registry used by the server).
 */

import fs from 'fs';
import path from 'path';
import { Database } from 'bun:sqlite';
import { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { eq, or, isNull, inArray } from 'drizzle-orm';
import * as schema from '../db/schema.ts';
import { oracleDocuments } from '../db/schema.ts';
import { createDatabase } from '../db/index.ts';
import { detectProject } from '../server/project-detect.ts';
import type { OracleDocument, IndexerConfig } from '../types.ts';
import { documentStorageId, storedProject } from '../document-identity.ts';

import { setIndexingStatus } from './status.ts';
import { backupDatabase } from './backup.ts';
import { parseResonanceFile, parseLearningFile, parseRetroFile, parseDistillationFile } from './parser.ts';
import { collectDocuments, collectSecurityCorpus } from './collectors.ts';
import { storeDocuments } from './storage.ts';

export interface IndexOptions {
  append?: boolean;
}

export class OracleIndexer {
  private sqlite: Database;
  private db: BunSQLiteDatabase<typeof schema>;
  private config: IndexerConfig;
  private project: string | null;
  private seenContentHashes: Set<string> = new Set();

  constructor(config: IndexerConfig) {
    this.config = config;
    const { sqlite, db } = createDatabase(config.dbPath);
    this.sqlite = sqlite;
    this.db = db;
    this.project = storedProject(detectProject(config.repoRoot));
    console.log(`[Indexer] Detected project: ${this.project || '(universal)'}`);
  }

  /**
   * Main indexing workflow
   */
  async index(options: IndexOptions = {}): Promise<void> {
    const append = options.append === true;
    console.log(append ? 'Starting Oracle indexing in append mode...' : 'Starting Oracle indexing...');
    this.seenContentHashes.clear();

    setIndexingStatus(this.sqlite, this.config, true, 0, 100);
    backupDatabase(this.sqlite, this.config);

    // Safety: verify the source directory layout exists. If ψ/memory/ is
    // completely missing, abort before smart-delete to prevent wiping the DB
    // when the indexer is launched from the wrong working directory.
    const psiMemoryDir = path.join(this.config.repoRoot, '\u03c8', 'memory');
    const existingIndexerDocCount = this.db.select({ id: oracleDocuments.id })
      .from(oracleDocuments)
      .where(or(eq(oracleDocuments.createdBy, 'indexer'), isNull(oracleDocuments.createdBy)))
      .all().length;

    if (!append && !fs.existsSync(psiMemoryDir) && existingIndexerDocCount > 0) {
      throw new Error(
        `Refusing to index: ${psiMemoryDir} does not exist but DB has ${existingIndexerDocCount} indexer docs. ` +
        `Set ORACLE_REPO_ROOT or run from a directory containing ψ/memory/ to avoid data loss.`
      );
    }

    // Collect documents from all source types
    const shared = { config: this.config, seenContentHashes: this.seenContentHashes };
    const documents: OracleDocument[] = [
      ...collectDocuments({ ...shared, subdir: 'resonance', parseFn: parseResonanceFile, label: 'resonance' }),
      ...collectDocuments({ ...shared, subdir: 'learnings', parseFn: parseLearningFile, label: 'learning' }),
      ...collectDocuments({ ...shared, subdir: 'retrospectives', parseFn: parseRetroFile, label: 'retrospective' }),
      ...collectDocuments({ ...shared, subdir: 'distillations', parseFn: parseDistillationFile, label: 'distillation' }),
      ...collectSecurityCorpus(shared),
    ];

    // Safety: never wipe an existing index when source discovery is empty.
    if (!append && documents.length === 0 && existingIndexerDocCount > 0) {
      throw new Error(
        `Refusing to index: found 0 source documents but DB has ${existingIndexerDocCount} indexer docs. ` +
        `Check that ψ/memory/ contains .md files and ORACLE_REPO_ROOT points to the correct location.`
      );
    }

    if (append) {
      console.log('Append mode: skipping smart delete (preserving existing docs from other repo roots)');
    } else {
      const incomingBySource = new Map<string, Set<string>>();
      const indexedProjects = new Set<string | null>([this.project]);
      for (const document of documents) {
        const documentProject = storedProject(document.project === undefined ? this.project : document.project);
        indexedProjects.add(documentProject);
        const ids = incomingBySource.get(document.source_file) || new Set<string>();
        ids.add(documentStorageId(documentProject, document.id));
        incomingBySource.set(document.source_file, ids);
      }

      const allIndexerDocs = this.db.select({
        id: oracleDocuments.id,
        sourceFile: oracleDocuments.sourceFile,
        project: oracleDocuments.project,
      })
        .from(oracleDocuments)
        .where(or(eq(oracleDocuments.createdBy, 'indexer'), isNull(oracleDocuments.createdBy)))
        .all();
      const idsToDelete = allIndexerDocs
        .filter(document => {
          if (!indexedProjects.has(document.project)) return false;
          const sourcePath = path.isAbsolute(document.sourceFile)
            ? document.sourceFile
            : path.join(this.config.repoRoot, document.sourceFile);
          const incomingIds = incomingBySource.get(document.sourceFile);
          return !fs.existsSync(sourcePath) || (incomingIds !== undefined && !incomingIds.has(document.id));
        })
        .map(document => document.id);


      // Safety: if smart-delete would drop more than half of existing indexer
      // docs, we're almost certainly running from the wrong repoRoot — the docs
      // on disk at this repoRoot just don't match what's in the DB. Abort rather
      // than wiping historical data. Set ORACLE_FORCE_REINDEX=1 to override.
      const forceFlag = process.env.ORACLE_FORCE_REINDEX === '1';
      if (
        !forceFlag &&
        allIndexerDocs.length > 0 &&
        idsToDelete.length / allIndexerDocs.length > 0.5
      ) {
        throw new Error(
          `Refusing to delete ${idsToDelete.length}/${allIndexerDocs.length} docs (>50%). ` +
          `repoRoot="${this.config.repoRoot}" likely doesn't match the source files this DB was built from. ` +
          `Set ORACLE_REPO_ROOT to the correct path, or ORACLE_FORCE_REINDEX=1 to override.`
        );
      }

      console.log(`Smart delete: ${idsToDelete.length} stale docs (preserving oracle_learn)`);

      if (idsToDelete.length > 0) {
        this.db.delete(oracleDocuments).where(inArray(oracleDocuments.id, idsToDelete)).run();
        const BATCH_SIZE = 500;
        for (let i = 0; i < idsToDelete.length; i += BATCH_SIZE) {
          const batch = idsToDelete.slice(i, i + BATCH_SIZE);
          const placeholders = batch.map(() => '?').join(',');
          this.sqlite.prepare(`DELETE FROM oracle_fts WHERE id IN (${placeholders})`).run(...batch);
        }
      }
    }

    // Store in SQLite + FTS5 only. Vector indexing is a separate step
    // (src/scripts/index-model.ts) that uses the canonical LanceDB path.
    await storeDocuments(this.sqlite, this.db, null, this.project, documents);

    setIndexingStatus(this.sqlite, this.config, false, documents.length, documents.length);
    console.log(`Indexed ${documents.length} documents (SQLite + FTS5)`);
    console.log('Run `bun src/scripts/index-model.ts bge-m3` to populate vector embeddings.');
    console.log('Indexing complete!');
  }

  /** Close database connections */
  async close(): Promise<void> {
    this.sqlite.close();
  }
}
