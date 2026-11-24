/**
 * `arra init [dir]` — make `<dir>/.arra/` a local arra: config, latest-schema DB, ψ indexed.
 *
 * The only command that is CLI-only (there is no server yet when you run it). It never touches
 * `~/.arra-oracle-v2`: no init means today's arra, unchanged. Running it twice reports and checks
 * instead of rebuilding.
 */

import fs from 'fs';
import path from 'path';
import { repoTop } from './git.ts';
import { copyRowsFrom } from './init-from.ts';
import { readConfig, writeConfig, type ArraConfig, type VaultRef } from './state.ts';

export interface InitOptions {
  dir: string;
  name?: string;
  hub?: boolean;
  hubName?: string;
  vaults?: VaultRef[];
  from?: string;
  reindex?: boolean;
}

export interface InitResult {
  dir: string;
  dataDir: string;
  created: boolean;
  config: ArraConfig;
  gitRepo: string | null;
  gitignore: 'added' | 'present' | 'skipped';
  envrc: 'written' | 'updated' | 'present' | 'skipped';
  indexed: { ran: boolean; ok: boolean; summary: string[] };
  copiedFrom?: { from: string; rows: number };
  exportLines: string[];
}

const REPO = path.resolve(import.meta.dir, '..', '..');

export function envLines(dir: string): string[] {
  return [`export ORACLE_DATA_DIR="${path.join(dir, '.arra')}"`, `export ORACLE_REPO_ROOT="${dir}"`];
}

function ensureGitignore(top: string, dir: string): 'added' | 'present' {
  const file = path.join(dir, '.gitignore');
  const rel = path.relative(top, path.join(dir, '.arra')) || '.arra';
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
  const lines = current.split('\n').map((l) => l.trim());
  if (lines.includes('.arra/') || lines.includes('.arra') || lines.includes(`/${rel}/`)) return 'present';
  const sep = current && !current.endsWith('\n') ? '\n' : '';
  fs.writeFileSync(file, `${current}${sep}# arra local DB (rebuildable cache, never commit)\n.arra/\n`);
  return 'added';
}

function ensureEnvrc(dir: string): 'written' | 'updated' | 'present' {
  const file = path.join(dir, '.envrc');
  const wanted = envLines(dir);
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, `# written by arra init\n${wanted.join('\n')}\n`);
    return 'written';
  }
  const current = fs.readFileSync(file, 'utf-8');
  const missing = wanted.filter((line) => !current.includes(line.split('=')[0] + '='));
  if (!missing.length) return 'present';
  const sep = current.endsWith('\n') ? '' : '\n';
  fs.writeFileSync(file, `${current}${sep}# added by arra init\n${missing.join('\n')}\n`);
  return 'updated';
}

/** Build the schema and index `<dir>/ψ` in a child process pointed at the new data dir. */
function runIndexer(dir: string, dataDir: string): { ok: boolean; summary: string[] } {
  const hasPsi = fs.existsSync(path.join(dir, 'ψ'));
  const script = hasPsi ? path.join(REPO, 'src', 'indexer', 'cli.ts') : path.join(REPO, 'src', 'arra', 'init-db.ts');
  const proc = Bun.spawnSync(['bun', script], {
    cwd: dir,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 30 * 60_000,
    env: {
      ...process.env,
      ORACLE_DATA_DIR: dataDir,
      ORACLE_REPO_ROOT: dir,
      // explicit: under NODE_ENV=test an unset path means :memory:
      ORACLE_DB_PATH: path.join(dataDir, 'oracle.db'),
      DATABASE_URL: '',
      ORACLE_EMBEDDER: process.env.ORACLE_EMBEDDER || 'none',
    },
  });
  const lines = `${proc.stdout}\n${proc.stderr}`.split('\n').map((l) => l.trim()).filter(Boolean);
  const summary = [...new Set(lines.filter((l) => /^(Indexed [1-9]|Indexing complete|schema|error)/i.test(l)))];
  return { ok: proc.exitCode === 0, summary: summary.length ? summary : lines.slice(-5) };
}

export function initArra(opts: InitOptions): InitResult {
  const dir = path.resolve(opts.dir);
  if (!fs.existsSync(dir)) throw new Error(`directory does not exist: ${dir}`);
  const dataDir = path.join(dir, '.arra');
  const existing = readConfig(dataDir);
  fs.mkdirSync(dataDir, { recursive: true });

  const config: ArraConfig = existing ?? {
    version: 1,
    name: opts.name?.trim() || path.basename(dir),
    createdAt: new Date().toISOString(),
    vaults: [],
  };
  if (opts.name?.trim()) config.name = opts.name.trim();
  for (const vault of opts.vaults ?? []) {
    const resolved = { name: vault.name, path: path.resolve(vault.path) };
    config.vaults = [...config.vaults.filter((v) => v.name !== resolved.name), resolved];
  }
  if (opts.hub) config.hub = { ...(config.hub ?? {}), name: opts.hubName?.trim() || config.hub?.name || config.name };
  writeConfig(config, dataDir);

  const top = repoTop(dir);
  const gitignore = top ? ensureGitignore(top, dir) : 'skipped';
  const envrc = top ? ensureEnvrc(dir) : 'skipped';

  const dbExists = fs.existsSync(path.join(dataDir, 'oracle.db'));
  const shouldIndex = !existing || !dbExists || !!opts.reindex;
  const indexed = shouldIndex ? { ran: true, ...runIndexer(dir, dataDir) } : { ran: false, ok: true, summary: ['already initialized: index kept (use --reindex to rebuild)'] };

  const result: InitResult = {
    dir, dataDir, created: !existing, config, gitRepo: top, gitignore, envrc, indexed,
    exportLines: top ? [] : envLines(dir),
  };
  if (opts.from) result.copiedFrom = { from: opts.from, rows: copyRowsFrom(opts.from, dataDir, dir) };
  return result;
}
