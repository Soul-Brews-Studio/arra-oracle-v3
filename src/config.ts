/**
 * Arra Oracle Configuration Constants
 *
 * Pure config — no DB connections, no table creation.
 * Extracted from src/server/db.ts to break circular dependencies.
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// ES Module compatibility for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Project root (parent of src/)
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Configuration
export const PORT = parseInt(String(process.env.ORACLE_PORT || 47778), 10);
export const HOME_DIR = process.env.HOME || process.env.USERPROFILE || '/tmp';
export const ORACLE_DATA_DIR = process.env.ORACLE_DATA_DIR || path.join(HOME_DIR, '.oracle');
export const DB_PATH = process.env.ORACLE_DB_PATH || path.join(ORACLE_DATA_DIR, 'oracle.db');
// REPO_ROOT for features that need knowledge base context
// When running from source: defaults to project root (where ψ/ lives)
// When running via bunx: set ORACLE_REPO_ROOT explicitly
// Fallback: ~/.oracle for bunx installs
export const REPO_ROOT = process.env.ORACLE_REPO_ROOT ||
  (fs.existsSync(path.join(PROJECT_ROOT, 'ψ')) ? PROJECT_ROOT : ORACLE_DATA_DIR);

// Ensure data directory exists (for fresh installs via bunx)
if (!fs.existsSync(ORACLE_DATA_DIR)) {
  fs.mkdirSync(ORACLE_DATA_DIR, { recursive: true });
}
