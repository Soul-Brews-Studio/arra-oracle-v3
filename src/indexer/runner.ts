/**
 * Shared reindex runner for the CLI and HTTP API.
 *
 * Keeps repoRoot resolution in one place so `bun run index`,
 * `POST /api/indexer/reindex`, and `arra-cli reindex` all index the same
 * source tree unless explicitly overridden.
 */

import fs from 'fs';
import path from 'path';
import { DB_PATH, CHROMADB_DIR } from '../config.ts';
import { getVaultPsiRoot } from '../vault/handler.ts';
import type { IndexerConfig } from '../types.ts';
import { OracleIndexer } from './index.ts';

const scriptDir = import.meta.dirname || path.dirname(new URL(import.meta.url).pathname);
const projectRoot = path.resolve(scriptDir, '..', '..');

export function normalizeIndexerRepoRoot(root: string): string {
  const resolved = path.resolve(root);
  if (path.basename(resolved) === '\u03c8' && fs.existsSync(path.join(resolved, 'memory'))) {
    return path.dirname(resolved);
  }
  return resolved;
}

export function resolveIndexerRepoRoot(explicitRoot?: string | null): string {
  if (explicitRoot?.trim()) return normalizeIndexerRepoRoot(explicitRoot);
  if (process.env.ORACLE_REPO_ROOT?.trim()) return normalizeIndexerRepoRoot(process.env.ORACLE_REPO_ROOT);

  const vaultResult = getVaultPsiRoot();
  const vaultRoot = 'path' in vaultResult ? vaultResult.path : null;
  const vaultHasContent = vaultRoot && (
    fs.existsSync(path.join(vaultRoot, 'ψ')) ||
    fs.existsSync(path.join(vaultRoot, 'github.com'))
  );

  if (vaultHasContent) return vaultRoot;
  if (fs.existsSync(path.join(projectRoot, 'ψ'))) return projectRoot;
  return process.cwd();
}

export function createIndexerConfig(repoRoot: string): IndexerConfig {
  return {
    repoRoot,
    dbPath: DB_PATH,
    chromaPath: CHROMADB_DIR,
    sourcePaths: {
      resonance: 'ψ/memory/resonance',
      learnings: 'ψ/memory/learnings',
      retrospectives: 'ψ/memory/retrospectives',
      distillations: 'ψ/memory/distillations',
      learn: 'ψ/learn',
      // Opt-in: set ORACLE_INDEX_SECURITY_CORPUS=1 to include ψ/learn/security-corpus/.
      // Default OFF because the corpus has ~36k files (one-time index ~10-30 min).
      security_corpus: process.env.ORACLE_INDEX_SECURITY_CORPUS === '1'
        ? 'ψ/learn/security-corpus'
        : undefined,
    },
  };
}

export async function runOracleReindex(opts: { repoRoot?: string | null; append?: boolean } = {}) {
  const repoRoot = resolveIndexerRepoRoot(opts.repoRoot);
  const append = opts.append === true;
  const config = createIndexerConfig(repoRoot);
  const indexer = new OracleIndexer(config);

  try {
    await indexer.index({ append });
    return { ok: true as const, repoRoot, append };
  } finally {
    await indexer.close();
  }
}
