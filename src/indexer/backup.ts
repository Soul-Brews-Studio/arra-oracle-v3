/**
 * Database backup before destructive operations
 * Philosophy: "Nothing is Deleted" - always preserve data
 */

import fs from 'fs';
import { Database } from 'bun:sqlite';
import type { IndexerConfig } from '../types.ts';

/**
 * Backup database before destructive operations
 *
 * Creates:
 * 1. SQLite file backup (.backup-TIMESTAMP)
 * 2. JSON export (.export-TIMESTAMP.json) for portability
 * 3. CSV export (.export-TIMESTAMP.csv) for DuckDB/analytics
 */
export function backupDatabase(sqlite: Database, config: IndexerConfig): void {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${config.dbPath}.backup-${timestamp}`;
  const jsonPath = `${config.dbPath}.export-${timestamp}.json`;
  const csvPath = `${config.dbPath}.export-${timestamp}.csv`;

  // 1. Copy SQLite file
  try {
    fs.copyFileSync(config.dbPath, backupPath);
    console.log(`\u{1f4e6} DB backup: ${backupPath}`);
  } catch (e) {
    console.warn(`\u26a0\ufe0f DB backup failed: ${e instanceof Error ? e.message : e}`);
  }

  // Query all documents for export
  let docs: any[] = [];
  try {
    docs = sqlite.prepare(`
      SELECT d.id, d.type, d.source_file, d.concepts, d.project, f.content
      FROM oracle_documents d
      JOIN oracle_fts f ON d.id = f.id
    `).all() as any[];
  } catch (e) {
    console.warn(`\u26a0\ufe0f Query failed: ${e instanceof Error ? e.message : e}`);
    return;
  }

  // 2. Export to JSON (portable, human-readable)
  try {
    const exportData = {
      exported_at: new Date().toISOString(),
      count: docs.length,
      documents: docs.map(d => ({
        ...d,
        concepts: JSON.parse(d.concepts || '[]')
      }))
    };
    fs.writeFileSync(jsonPath, JSON.stringify(exportData, null, 2));
    console.log(`\u{1f4c4} JSON export: ${jsonPath} (${docs.length} docs)`);
  } catch (e) {
    console.warn(`\u26a0\ufe0f JSON export failed: ${e instanceof Error ? e.message : e}`);
  }

  // 3. Export to CSV (DuckDB-friendly)
  try {
    const escapeCSV = (val: string) => {
      if (val.includes('"') || val.includes(',') || val.includes('\n')) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    };

    const header = 'id,type,source_file,concepts,project,content';
    const rows = docs.map(d =>
      [d.id, d.type, d.source_file, d.concepts, d.project || '', d.content]
        .map(v => escapeCSV(String(v || '')))
        .join(',')
    );

    fs.writeFileSync(csvPath, [header, ...rows].join('\n'));
    console.log(`\u{1f4ca} CSV export: ${csvPath} (${docs.length} rows)`);
  } catch (e) {
    console.warn(`\u26a0\ufe0f CSV export failed: ${e instanceof Error ? e.message : e}`);
  }
}
