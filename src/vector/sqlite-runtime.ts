import { existsSync } from 'node:fs';
import { Database } from 'bun:sqlite';

// macOS ships bun:sqlite against Apple's system libsqlite3, which is built
// without SQLITE_ENABLE_LOAD_EXTENSION — loadExtension() throws regardless of
// the extension path, for every Database instance in the process, once any
// Database has already been opened. Point Bun at a Homebrew sqlite3 build
// (which does support it) before the first Database anywhere is constructed —
// callers must import and invoke this before any other module that might open
// a Database (e.g. before ./db/index.ts is touched).
let customSqliteApplied = false;
export function ensureExtensionCapableSqlite(): void {
  if (customSqliteApplied || process.platform !== 'darwin') return;
  customSqliteApplied = true;
  const candidates = [
    process.env.ORACLE_SQLITE_LIB,
    '/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib',
    '/usr/local/opt/sqlite/lib/libsqlite3.dylib',
  ].filter((path): path is string => !!path);
  const path = candidates.find((candidate) => existsSync(candidate));
  if (path) Database.setCustomSQLite(path);
}
