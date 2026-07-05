import { getTableName } from 'drizzle-orm';

type ExportTable = Parameters<typeof getTableName>[0];

export function parseCollectionFilter(value: string): string[] {
  const names = value.split(',').map((name) => name.trim()).filter(Boolean);
  if (names.length === 0) throw new Error('missing value for --collection');
  return names;
}

export function appendCollectionFilter(current: string[], value: string): string[] {
  return [...current, ...parseCollectionFilter(value)];
}

export function selectExportTables<T extends ExportTable>(
  tables: T[],
  collections: readonly string[] = [],
): T[] {
  if (collections.length === 0) return tables;

  const byName = new Map(tables.map((table) => [getTableName(table), table]));
  const selected: T[] = [];
  const seen = new Set<string>();

  for (const collection of collections) {
    if (seen.has(collection)) continue;
    const table = byName.get(collection);
    if (!table) {
      throw new Error(`unknown export collection: ${collection}. Available: ${[...byName.keys()].join(', ')}`);
    }
    selected.push(table);
    seen.add(collection);
  }

  return selected;
}

export function shouldExportDocuments(collections: readonly string[] = []): boolean {
  return collections.length === 0 || collections.includes('oracle_documents');
}
