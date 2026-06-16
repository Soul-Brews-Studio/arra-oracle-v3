import { flag, parseArgs, requestText } from './http.ts';

type ExportFormat = 'json' | 'csv' | 'md';

const allowedFormats = new Set<ExportFormat>(['json', 'csv', 'md']);

function normalizeFormat(value: string | undefined): ExportFormat {
  const format = (value || 'json').toLowerCase();
  if (!allowedFormats.has(format as ExportFormat)) {
    throw new Error('usage: maw arra export --collection X --format json|csv|md');
  }
  return format as ExportFormat;
}

function apiFormat(format: ExportFormat): string {
  return format === 'md' ? 'markdown' : format;
}

function acceptHeader(format: ExportFormat): string {
  if (format === 'csv') return 'text/csv';
  if (format === 'md') return 'text/markdown';
  return 'application/json';
}

export async function runExportCommand(args: string[]): Promise<string> {
  const parsed = parseArgs(args);
  const collection = flag(parsed, 'collection') || parsed.positionals[0];
  if (!collection) throw new Error('usage: maw arra export --collection X --format json|csv|md');

  const format = normalizeFormat(flag(parsed, 'format') || parsed.positionals[1]);
  const query = new URLSearchParams({ collection, format: apiFormat(format) });
  return requestText(`/api/v1/vector/export?${query.toString()}`, {
    headers: { accept: acceptHeader(format) },
  });
}
