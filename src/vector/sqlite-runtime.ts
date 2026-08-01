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
  if (!path) return;
  try {
    Database.setCustomSQLite(path);
  } catch (err) {
    // `bun test --isolate` gives every test file a fresh global object, which
    // resets the `customSqliteApplied` guard above — but Database.setCustomSQLite
    // is a process-wide, call-it-exactly-once native operation, not a per-file
    // one. So the *first* test file in an isolated run to reach here sets it
    // successfully; every later file in the same `bun test` process re-enters
    // this function with a fresh (false) guard and throws "SQLite already
    // loaded" even though the custom build is already active for the whole
    // process. Swallow exactly that: by the time this throws, some sqlite
    // (this file's own attempt or an earlier file's) has already loaded, so
    // there is nothing left to fix here — re-throwing would fail every test
    // file after the first one in any multi-file `bun test --isolate` run.
    if (!(err instanceof Error) || !err.message.includes('SQLite already loaded')) throw err;
  }
}
