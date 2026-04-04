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
export const PORT = parseInt(String(process.env.ORACLE_PORT || C.ORACLE_DEFAULT_PORT), 10);
export const ORACLE_DATA_DIR = process.env.ORACLE_DATA_DIR || path.join(HOME_DIR, C.ORACLE_DATA_DIR_NAME);
export const DB_PATH = process.env.ORACLE_DB_PATH || path.join(ORACLE_DATA_DIR, C.ORACLE_DB_FILE);

// REPO_ROOT: where ψ/ lives
// From source: project root. Via bunx: set ORACLE_REPO_ROOT. Fallback: data dir.
export const REPO_ROOT = process.env.ORACLE_REPO_ROOT ||
  (fs.existsSync(path.join(PROJECT_ROOT, 'ψ')) ? PROJECT_ROOT : ORACLE_DATA_DIR);

// Derived paths — import these, don't compute inline
export const FEED_LOG = path.join(ORACLE_DATA_DIR, C.FEED_LOG_FILE);
export const PLUGINS_DIR = path.join(ORACLE_DATA_DIR, C.PLUGINS_DIR_NAME);
export const SCHEDULE_PATH = path.join(ORACLE_DATA_DIR, C.SCHEDULE_FILE);
export const VECTORS_DB_PATH = path.join(ORACLE_DATA_DIR, C.VECTORS_DB_FILE);
export const LANCEDB_DIR = path.join(ORACLE_DATA_DIR, C.LANCEDB_DIR_NAME);
export const CHROMADB_DIR = path.join(HOME_DIR, C.CHROMADB_DIR_NAME);

// MCP Remote Transport auth token — required for /mcp endpoint
// If empty, /mcp will reject all requests with 401 (fail-safe)
export const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN || '';

// OAuth 2.1 — PIN-based auth for Claude Desktop / claude.ai Custom Connectors
// If MCP_OAUTH_PIN is empty, OAuth routes are not mounted (Bearer-only mode)
export const MCP_OAUTH_PIN = process.env.MCP_OAUTH_PIN || '';
export const MCP_EXTERNAL_URL = process.env.MCP_EXTERNAL_URL || `http://localhost:${PORT}`;

if (MCP_EXTERNAL_URL.startsWith('http://') && !MCP_EXTERNAL_URL.includes('localhost') && !MCP_EXTERNAL_URL.includes('127.0.0.1')) {
  console.warn('⚠️  MCP_EXTERNAL_URL is using HTTP in production — OAuth requires HTTPS for secure token exchange');
}

// Ensure data directory exists (for fresh installs via bunx)
if (!fs.existsSync(ORACLE_DATA_DIR)) {
  fs.mkdirSync(ORACLE_DATA_DIR, { recursive: true });
}
