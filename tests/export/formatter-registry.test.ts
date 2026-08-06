import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { registerPluginExportFormats } from '../../src/plugins/export-format-init.ts';
import {
  exportFormatInfo,
  getExportFormat,
  registerExportFormat,
  type EmbeddingDump,
  type ExportFormatter,
} from '../../src/vector/export-formats.ts';

const tmp = mkdtempSync(join(tmpdir(), 'arra-export-registry-'));
const emptyDump: EmbeddingDump = { ids: [], embeddings: [], metadatas: [], documents: [] };

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function streamText(format: string, dump = emptyDump): Promise<string> {
  const formatter = getExportFormat(format);
  if (!formatter) throw new Error(`missing formatter: ${format}`);
  return new Response(formatter(dump)).text();
}

function formatter(): ExportFormatter {
  return (() => new ReadableStream<Uint8Array>({ start: (controller) => controller.close() })) as ExportFormatter;
}

function plugin(name: string, entry: string, format: string, handler = 'register') {
  const dir = join(tmp, name);
  const entryPath = join(dir, 'index.ts');
  mkdirSync(dir, { recursive: true });
  writeFileSync(entryPath, entry, { flag: 'w' });
  return {
    entryPath,
    manifest: {
      name,
      version: '1.0.0',
      entry: './index.ts',
      sdk: 'arra-oracle-v3',
      depends: [],
      apiRoutes: [],
      mcpTools: [],
      proxy: [],
      menu: [],
      cliSubcommands: [],
      exportFormats: [{ name: format, handler }],
    },
  } as any;
}

describe('ExportFormatter registry hardening', () => {
  test('built-in json/jsonl/csv/markdown/v2 format empty collections safely', async () => {
    expect(await streamText('json')).toBe('[]');
    expect(await streamText('jsonl')).toBe('');
    expect(await streamText('csv')).toBe('id,document,type,source_file,concepts\n');
    expect(await streamText('markdown')).toBe('');
    expect(await streamText('v2')).toBe('{"version":1,"documents":[]}');
  });

  test('rejects invalid format names before registry lookup or registration', () => {
    expect(getExportFormat('../json')).toBeUndefined();
    expect(exportFormatInfo('json/lines')).toBeUndefined();
    expect(() => registerExportFormat('bad format', formatter())).toThrow('invalid export format');
    expect(() => registerExportFormat('bad', 42 as unknown as ExportFormatter)).toThrow('must be a function');
  });

  test('plugin export format handlers can return a formatter for registration', async () => {
    const format = `c10-plugin-${Date.now().toString(36)}`;
    const result = await registerPluginExportFormats(plugin('returning-format', `
      const encoder = new TextEncoder();
      export function register() {
        return Object.assign((dump) => new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(dump.ids.join('|')));
            controller.close();
          },
        }), { contentType: 'text/plain; charset=utf-8', extension: 'txt', label: 'C10 Plugin' });
      }
    `, format), 500);

    expect(result).toBeUndefined();
    expect(exportFormatInfo(format)).toMatchObject({ format, extension: 'txt', label: 'C10 Plugin' });
    expect(await streamText(format, { ids: ['a', 'b'], embeddings: [], metadatas: [], documents: [] })).toBe('a|b');
  });

  test('plugin export format init reports handlers that never register their declared format', async () => {
    const format = `c10-missing-${Date.now().toString(36)}`;
    const result = await registerPluginExportFormats(plugin('missing-format', 'export function register() { return undefined; }', format), 500);

    expect(result).toBe(`export format not registered: ${format}`);
    expect(getExportFormat(format)).toBeUndefined();
  });

  test('plugin export handlers receive the registration context seam', async () => {
    const format = `c10-context-${Date.now().toString(36)}`;
    const result = await registerPluginExportFormats(plugin('context-format', `
      const encoder = new TextEncoder();
      export function register(ctx) {
        if (ctx.source !== 'exportFormat' || ctx.plugin !== 'context-format' || ctx.format !== '${format}') {
          throw new Error('bad export format context');
        }
        ctx.registerExportFormat(ctx.format, Object.assign((dump) => new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(ctx.config.mode + ':' + dump.ids.length));
            controller.close();
          },
        }), { contentType: 'text/plain; charset=utf-8', extension: 'ctx', label: 'Context Format' }));
      }
    `, format), 500);

    expect(result).toBeUndefined();
    expect(exportFormatInfo(format)).toMatchObject({ extension: 'ctx', label: 'Context Format' });
    expect(await streamText(format, { ids: ['one'], embeddings: [], metadatas: [], documents: [] })).toBe('undefined:1');
  });
});
