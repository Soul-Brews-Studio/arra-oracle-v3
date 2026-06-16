import { createDatabase } from '../../db/index.ts';
import {
  buildMarkdownExportPayload,
  buildVaultJsonExport,
  buildVectorExportPayload,
} from '../../cli/commands/export.ts';
import { exportFormatInfo } from '../../vector/export-formats.ts';
import type { ExportPayload, ExportRequest } from './model.ts';
import { resolveExportFormat, resolveExportSource } from './model.ts';

const DEFAULT_COLLECTION = 'bge-m3';
const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

export async function buildDataExportPayload(request: ExportRequest): Promise<ExportPayload> {
  const format = resolveExportFormat(request.format);
  const source = resolveExportSource(format, request.source);

  if (format === 'markdown') {
    const connection = createDatabase();
    try {
      return {
        data: await buildMarkdownExportPayload(connection),
        contentType: 'text/markdown; charset=utf-8',
        extension: 'md',
      };
    } finally {
      connection.storage.close();
    }
  }

  if (source === 'vault') {
    if (format !== 'json') throw new Error(`vault export does not support format: ${format}`);
    const connection = createDatabase();
    try {
      return {
        data: `${JSON.stringify(buildVaultJsonExport(connection), null, 2)}\n`,
        contentType: JSON_CONTENT_TYPE,
        extension: 'json',
      };
    } finally {
      connection.storage.close();
    }
  }

  const info = exportFormatInfo(format);
  if (!info) throw new Error(`unsupported format: ${format}`);
  return {
    data: await buildVectorExportPayload(request.collection ?? DEFAULT_COLLECTION, format),
    contentType: info.mimeType,
    extension: info.extension,
  };
}
