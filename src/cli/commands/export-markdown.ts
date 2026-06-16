/**
 * Markdown-specific export helpers.
 *
 * Kept separate so `export.ts` stays under 250 lines and the formatter
 * surface stays focused.
 */

export type ExportCollection = {
  name: string;
  source: "vector" | "sqlite";
  count: number;
  records: ExportRecord[];
  error?: string;
};

export type ExportFormat = "json" | "jsonl" | "csv" | "markdown" | "v2";

export type ExportRecord = Record<string, unknown>;

export const MARKDOWN_COLLECTION_PREFIX = 'markdown';

export function normalizeForMarkdown(collections: ExportCollection[]): ExportCollection[] {
  return collections.map((collection) => {
    if (collection.source === 'sqlite') {
      return {
        ...collection,
        name: `sqlite/${collection.name}`,
      };
    }
    return collection;
  });
}

export function ensureMarkdownFinalSectionOrder(
  collections: ExportCollection[],
): ExportCollection[] {
  const out = [...collections];
  out.sort((a, b) => {
    if (a.name === 'vector/oracle_documents' || a.name === 'sqlite/oracle_documents') return 1;
    if (b.name === 'vector/oracle_documents' || b.name === 'sqlite/oracle_documents') return -1;
    if (a.source === 'sqlite' && b.source === 'vector') return 1;
    if (a.source === 'vector' && b.source === 'sqlite') return -1;
    return a.name.localeCompare(b.name);
  });
  return out;
}

export function buildCollectionName(
  baseName: string,
  source: ExportCollection['source'],
): string {
  return source === 'sqlite' ? `sqlite/${baseName}` : `vector/${baseName}`;
}

export function coerceRecordsForExport(records: ExportRecord[]): ExportRecord[] {
  return records.map((record) => {
    const out: ExportRecord = {};
    for (const [key, value] of Object.entries(record)) {
      if (typeof value === 'bigint') {
        out[key] = value.toString();
      } else if (value instanceof Uint8Array) {
        out[key] = Array.from(value);
      } else if (value instanceof Date) {
        out[key] = value.toISOString();
      } else {
        out[key] = value;
      }
    }
    return out;
  });
}

export function isAllowedMarkdownFormat(format: ExportFormat): boolean {
  return format === 'markdown';
}
