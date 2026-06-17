/**
 * CLI entrypoint for running the Oracle indexer
 */

import fs from 'fs';
import path from 'path';
import { DB_PATH, CHROMADB_DIR } from '../config.ts';
import { getVaultPsiRoot } from '../vault/handler.ts';
import type { IndexerConfig } from '../types.ts';
import { OracleIndexer } from './index.ts';

// Prefer vault repo for centralized indexing, fall back to local psi/ detection
const scriptDir = import.meta.dirname || path.dirname(new URL(import.meta.url).pathname);
const projectRoot = path.resolve(scriptDir, '..', '..');

function resolveRepoRoot(repoRootOverride = process.env.ORACLE_REPO_ROOT): string {
  if (repoRootOverride) return repoRootOverride;

  const vaultResult = getVaultPsiRoot();
  const vaultRoot = 'path' in vaultResult ? vaultResult.path : null;

  // Vault may have project-first layout (github.com/org/repo/psi/) without a root psi/
  const vaultHasContent = vaultRoot && (
    fs.existsSync(path.join(vaultRoot, '\u03c8')) ||
    fs.existsSync(path.join(vaultRoot, 'github.com'))
  );

  return vaultHasContent ? vaultRoot :
    fs.existsSync(path.join(projectRoot, '\u03c8')) ? projectRoot : process.cwd();
}

export function createIndexerConfig(repoRootOverride = process.env.ORACLE_REPO_ROOT): IndexerConfig {
  return {
    repoRoot: resolveRepoRoot(repoRootOverride),
    dbPath: DB_PATH,
    chromaPath: CHROMADB_DIR,
    sourcePaths: {
      resonance: '\u03c8/memory/resonance',
      learnings: '\u03c8/memory/learnings',
      retrospectives: '\u03c8/memory/retrospectives',
      distillations: '\u03c8/memory/distillations',
      learn: '\u03c8/learn',
      // Opt-in: set ORACLE_INDEX_SECURITY_CORPUS=1 to include \u03c8/learn/security-corpus/.
      // Default OFF because the corpus has ~36k files (one-time index ~10-30 min).
      security_corpus: process.env.ORACLE_INDEX_SECURITY_CORPUS === '1'
        ? '\u03c8/learn/security-corpus'
        : undefined,
    }
  };
}

export type IndexerCliOptions = { repoRoot?: string; readOnly: boolean; help: boolean };

export function parseIndexerCliArgs(args: string[]): IndexerCliOptions {
  const options: IndexerCliOptions = { readOnly: false, help: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--read-only') options.readOnly = true;
    else if (arg === '--repo-root') {
      const value = args[++i]?.trim();
      if (!value) throw new Error('--repo-root requires a path');
      options.repoRoot = value;
    } else if (arg?.startsWith('--repo-root=')) {
      const value = arg.slice('--repo-root='.length).trim();
      if (!value) throw new Error('--repo-root requires a path');
      options.repoRoot = value;
    } else {
      throw new Error(`unknown index option: ${arg}`);
    }
  }
  return options;
}

function printUsage(): void {
  console.log('Usage: bun src/indexer/cli.ts [--repo-root <path>] [--read-only]');
  console.log('  --repo-root <path>  Index a specific repository root');
  console.log('  --read-only         Open vector sidecar dependencies in read-only mode');
}

if (import.meta.main) {
  let options: IndexerCliOptions;
  try {
    options = parseIndexerCliArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    printUsage();
    process.exit(1);
  }
  if (options.help) {
    printUsage();
    process.exit(0);
  }
  if (options.readOnly) process.env.ORACLE_VECTOR_READONLY = '1';
  const indexer = new OracleIndexer(createIndexerConfig(options.repoRoot));

  indexer.index()
    .then(async () => {
      console.log('Indexing complete!');
      await indexer.close();
    })
    .catch(async err => {
      console.error('Indexing failed:', err);
      await indexer.close();
      process.exit(1);
    });
}
