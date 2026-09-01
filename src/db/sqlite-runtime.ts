/**
 * Configures bun:sqlite's native SQLite build before any Database is constructed.
 *
 * bun's bundled sqlite3 ships without SQLITE_ENABLE_LOAD_EXTENSION, so
 * Database#loadExtension() (used to register the sqlite-vec `vec0` module) fails
 * everywhere with "This build of sqlite3 does not support dynamic extension
 * loading" — regardless of whether the extension file itself is present and
 * matches the host arch. Database.setCustomSQLite() points bun's bindings at a
 * system libsqlite3 built with extension loading, but it is a no-op once any
 * `new Database()` has already run in this process. So this module must be the
 * first import anywhere a Database might get constructed (see src/index.ts),
 * and must not itself import anything that could construct one.
 *
 * Ref: https://github.com/Soul-Brews-Studio/arra-oracle-v3/issues/2931
 */
import { Database } from 'bun:sqlite';
import fs from 'fs';

const CANDIDATE_PATHS: Record<string, string[]> = {
  'darwin-arm64': ['/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib'],
  'darwin-x64': ['/usr/local/opt/sqlite/lib/libsqlite3.dylib'],
  'linux-x64': ['/usr/lib/x86_64-linux-gnu/libsqlite3.so.0', '/usr/lib/libsqlite3.so.0'],
  'linux-arm64': ['/usr/lib/aarch64-linux-gnu/libsqlite3.so.0', '/usr/lib/libsqlite3.so.0'],
};

function resolveExtensionCapableSqlite(): string | undefined {
  const key = `${process.platform}-${process.arch}`;
  for (const candidate of CANDIDATE_PATHS[key] ?? []) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

const resolvedPath = resolveExtensionCapableSqlite();
if (resolvedPath) {
  Database.setCustomSQLite(resolvedPath);
  console.error(`[sqlite-runtime] Using extension-capable SQLite: ${resolvedPath}`);
} else {
  console.error(
    `[sqlite-runtime] No extension-capable SQLite found for ${process.platform}-${process.arch}; ` +
      'bun\'s bundled sqlite3 cannot load extensions, so vec0 (semantic search) will fail. ' +
      'FTS5 keyword search is unaffected.',
  );
}
