export interface ExportBundleReadmeInput {
  exportedAt: string;
  dbPath: string;
  formats: readonly string[];
  collectionCount: number;
  rowCount: number;
  relationshipCount: number;
  documentCount: number;
}

export function exportBundleReadme(input: ExportBundleReadmeInput): string {
  return [
    '# Arra Oracle Export Bundle',
    '',
    `Generated: ${input.exportedAt}`,
    `Source database: ${input.dbPath}`,
    '',
    '## Snapshot Summary',
    '',
    `- Collections: ${input.collectionCount}`,
    `- Collection rows: ${input.rowCount}`,
    `- Documents: ${input.documentCount}`,
    `- Graph relationships: ${input.relationshipCount}`,
    `- Formats: ${input.formats.join(', ')}`,
    '',
    '## Bundle Contents',
    '',
    '- `documents/` contains Markdown, JSON, CSV, and index artifacts.',
    '- `collections/` contains every Drizzle collection in each export format.',
    '- `relationships.*` contains graph edges for preview and migration checks.',
    '- `all-collections.json` contains the full normalized collection snapshot.',
    '- `backup.sql` contains a standalone SQLite restore/preflight dump.',
    '- `manifest.json` contains counts plus the SHA-256 file inventory.',
    '- `manifest.schema.json` describes the manifest contract.',
    '',
    '## Verification Checklist',
    '',
    '1. Validate `manifest.json` against `manifest.schema.json`.',
    '2. Compare `collections.<table>.rowCount` with the source database.',
    '3. Recompute SHA-256 for files listed in `manifest.json.files`.',
    '4. Inspect Markdown documents before migration or restore work.',
    '',
    'CLI shortcut: `bun run tools/export-app/index.ts --verify <bundle-dir>`.',
    '',
  ].join('\n');
}
