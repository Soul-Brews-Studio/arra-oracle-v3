/**
 * Arra Oracle Configuration
 *
 * Resolves paths from const.ts + environment variables.
 * No DB connections, no table creation.
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import * as C from './const.ts';
import { validateEnv } from './config/validate.ts';

validateEnv({ emitOptionalWarnings: false });

// ES Module compatibility for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Project root (parent of src/)
const PROJECT_ROOT = path.resolve(__dirname, '..');

// HOME — fail fast if not set
const home = process.env.HOME || process.env.USERPROFILE;
if (!home) throw new Error('HOME environment variable not set — cannot resolve paths');
export const HOME_DIR = home;

// Core paths
function pathFromDatabaseUrl(value?: string): string {
  if (!value) return '';
  try {
    const url = new URL(value);
    if (url.protocol === 'file:') return fileURLToPath(url);
    if (url.protocol === 'sqlite:' || url.protocol === 'sqlite3:') {
      return decodeURIComponent(url.pathname || url.host);
    }
  } catch {
    return value;
  }
  return value;
}

export const PORT = parseInt(String(process.env.ORACLE_PORT || process.env.PORT || C.ORACLE_DEFAULT_PORT), 10);
export const ORACLE_DATA_DIR = process.env.ORACLE_DATA_DIR || path.join(HOME_DIR, C.ORACLE_DATA_DIR_NAME);
export const DB_PATH = process.env.ORACLE_DB_PATH || pathFromDatabaseUrl(process.env.DATABASE_URL) || path.join(ORACLE_DATA_DIR, C.ORACLE_DB_FILE);

// REPO_ROOT: where ψ/ lives.
// Priority:
//   1. ORACLE_REPO_ROOT env var — explicit override
//   2. ORACLE_DATA_DIR if it has ψ/ — canonical data location (outside code repo)
//   3. PROJECT_ROOT if it has ψ/ — dev mode for indexing the oracle's own psi
//   4. ORACLE_DATA_DIR — default (will be empty initially)
//
// Data dir wins over project root so that accidental ψ/ folders in a source
// checkout (e.g. from oracle_learn writing with no vault configured) don't
// override the real indexed data at ~/.arra-oracle-v2/ψ/.
export const REPO_ROOT = process.env.ORACLE_REPO_ROOT ||
  (fs.existsSync(path.join(ORACLE_DATA_DIR, '\u03c8')) ? ORACLE_DATA_DIR :
   fs.existsSync(path.join(PROJECT_ROOT, '\u03c8')) ? PROJECT_ROOT : ORACLE_DATA_DIR);

// Derived paths — import these, don't compute inline
export const FEED_LOG = path.join(ORACLE_DATA_DIR, C.FEED_LOG_FILE);
export const PLUGINS_DIR = path.join(ORACLE_DATA_DIR, C.PLUGINS_DIR_NAME);
export const SCHEDULE_PATH = path.join(ORACLE_DATA_DIR, C.SCHEDULE_FILE);
export const VECTORS_DB_PATH = path.join(ORACLE_DATA_DIR, C.VECTORS_DB_FILE);
export const LANCEDB_DIR = path.join(ORACLE_DATA_DIR, C.LANCEDB_DIR_NAME);
export const CHROMADB_DIR = path.join(HOME_DIR, C.CHROMADB_DIR_NAME);

// Ensure data directory exists (for fresh installs via bunx)
if (!fs.existsSync(ORACLE_DATA_DIR)) {
  fs.mkdirSync(ORACLE_DATA_DIR, { recursive: true });
}

// Vector layer routing (#1071 phase 1.2)
//   VECTOR_URL       — if set, vector calls proxy to this base URL (e.g. http://vector.local:8080)
//                      if empty, the local vector adapter is used (backward compat).
//   VECTOR_FALLBACK  — what to do when proxy is unreachable. 'fts5' = serve FTS5-only
//                      results with vectorAvailable: false. (Future: 'cache', 'fail'.)
//   VECTOR_DB_URL    — target for vector-server.json proxy manifests such as
//                      /api/vector-db → sidecar vector DB passthrough.
//   ORACLE_EMBEDDER  — 'none' (default), 'local', or 'remote'. Remote uses
//                      ORACLE_EMBEDDER_URL and falls back to FTS5 on failure.
export const VECTOR_URL = process.env.VECTOR_URL || '';
export const VECTOR_FALLBACK = process.env.VECTOR_FALLBACK || 'fts5';
