import type { ExportRecord } from './formats.ts';

export interface JsonCollectionExport {
  collection: string;
  rowCount: number;
  rows: ExportRecord[];
}

export function formatJsonCollection(collection: string, rows: ExportRecord[]): string {
  return `${JSON.stringify({ collection, rowCount: rows.length, rows } satisfies JsonCollectionExport, null, 2)}\n`;
}
