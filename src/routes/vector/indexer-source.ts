import { Database } from 'bun:sqlite';
import { DB_PATH } from '../../config.ts';
import { collectDocuments, collectSecurityCorpus } from '../../indexer/collectors.ts';
import { parseDistillationFile, parseLearningFile, parseResonanceFile, parseRetroFile } from '../../indexer/parser.ts';
import { createIndexerConfig, resolveIndexerRepoRoot } from '../../indexer/runner.ts';
import type { OracleDocument } from '../../types.ts';
import type { VectorDocument } from '../../vector/types.ts';

export type VectorIndexSource = 'auto' | 'vault' | 'sqlite';

export interface LoadedVectorIndexDocuments {
  source: Exclude<VectorIndexSource, 'auto'>;
  docs: VectorDocument[];
  repoRoot?: string;
}

export function resolveVectorIndexSource(value?: string | null): VectorIndexSource {
  const raw = (value || process.env.VECTOR_INDEX_SOURCE || process.env.ORACLE_VECTOR_INDEX_SOURCE || 'auto').toLowerCase();
  return raw === 'vault' || raw === 'sqlite' ? raw : 'auto';
}

function toVectorDocs(documents: OracleDocument[]): VectorDocument[] {
  return documents.map(doc => ({
    id: doc.id,
    document: doc.content,
    metadata: {
      type: doc.type,
      source_file: doc.source_file,
      concepts: JSON.stringify(doc.concepts),
      ...(doc.project && { project: doc.project }),
    },
  }));
}

export function loadVaultVectorDocuments(repoRoot = resolveIndexerRepoRoot()): LoadedVectorIndexDocuments {
  const config = createIndexerConfig(repoRoot);
  const shared = { config, seenContentHashes: new Set<string>() };
  const documents: OracleDocument[] = [
    ...collectDocuments({ ...shared, subdir: 'resonance', parseFn: parseResonanceFile, label: 'resonance' }),
    ...collectDocuments({ ...shared, subdir: 'learnings', parseFn: parseLearningFile, label: 'learning' }),
    ...collectDocuments({ ...shared, subdir: 'retrospectives', parseFn: parseRetroFile, label: 'retrospective' }),
    ...collectDocuments({ ...shared, subdir: 'distillations', parseFn: parseDistillationFile, label: 'distillation' }),
    ...collectSecurityCorpus(shared),
  ];

  return { source: 'vault', repoRoot, docs: toVectorDocs(documents) };
}

export function loadSqliteVectorDocuments(dbPath = DB_PATH): LoadedVectorIndexDocuments {
  const sqlite = new Database(dbPath, { readonly: true });
  try {
    const rows = sqlite.prepare(`
      SELECT d.id, d.type, GROUP_CONCAT(f.content, '\n') as content,
             d.source_file, d.concepts, d.project, d.created_at
      FROM oracle_documents d
      JOIN oracle_fts f ON d.id = f.id
      GROUP BY d.id
      ORDER BY d.created_at DESC
    `).all() as Array<{
      id: string; type: string; content: string;
      source_file: string; concepts: string; project: string | null;
      created_at: string;
    }>;

    return {
      source: 'sqlite',
      docs: rows.map(row => ({
        id: row.id,
        document: row.content,
        metadata: {
          type: row.type,
          source_file: row.source_file,
          concepts: row.concepts,
          ...(row.project && { project: row.project }),
        },
      })),
    };
  } finally {
    sqlite.close();
  }
}

export function loadVectorIndexDocuments(opts: {
  source?: string | null;
  repoRoot?: string | null;
  dbPath?: string;
} = {}): LoadedVectorIndexDocuments {
  const source = resolveVectorIndexSource(opts.source);
  if (source !== 'sqlite') {
    const vault = loadVaultVectorDocuments(opts.repoRoot ? resolveIndexerRepoRoot(opts.repoRoot) : undefined);
    if (source === 'vault' && vault.docs.length === 0) {
      throw new Error(`Refusing vault vector reindex: found 0 vault documents at ${vault.repoRoot}`);
    }
    if (vault.docs.length > 0) return vault;
  }
  return loadSqliteVectorDocuments(opts.dbPath);
}
