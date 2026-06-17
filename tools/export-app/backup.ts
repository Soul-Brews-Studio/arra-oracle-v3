import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildSqlDump } from '../../src/cli/commands/backup.ts';
import type { DatabaseConnection } from '../../src/db/index.ts';

type BackupTables = NonNullable<Parameters<typeof buildSqlDump>[1]>;

export interface StandaloneBackupDump {
  path: string;
  tableCount: number;
  rowCount: number;
}

export async function writeStandaloneBackupDump(options: {
  outputDir: string;
  connection: DatabaseConnection;
  tables: BackupTables;
  createdAt: Date;
}): Promise<StandaloneBackupDump> {
  const dump = buildSqlDump(options.connection, options.tables, options.createdAt);
  const relativePath = 'backup.sql';
  await writeFile(path.join(options.outputDir, relativePath), dump.sql, 'utf8');
  return { path: relativePath, tableCount: options.tables.length, rowCount: dump.rowCount };
}
