import type { ExportRecord } from './formats.ts';

export function formatJsonlCollection(_collection: string, rows: ExportRecord[]): string {
  return rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length > 0 ? '\n' : '');
}
