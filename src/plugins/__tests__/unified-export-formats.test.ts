import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getExportFormat } from '../../vector/export-formats.ts';
import { loadUnifiedPlugins } from '../unified-loader.ts';

const tmp = mkdtempSync(join(tmpdir(), 'arra-export-format-plugin-'));

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function pluginDir(name: string, manifest: Record<string, unknown>, entry: string) {
  const dir = join(tmp, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'plugin.json'), JSON.stringify({
    name,
    version: '1.0.0',
    entry: './index.ts',
    ...manifest,
  }, null, 2));
  writeFileSync(join(dir, 'index.ts'), entry);
}

test('plugin exportFormats handlers can register custom formats during init', async () => {
  pluginDir('format-pack', {
    exportFormats: [{ name: 'codex9-lines', handler: 'registerLines' }],
  }, `
    const encoder = new TextEncoder();
    export function registerLines(ctx) {
      ctx.registerExportFormat(ctx.format, Object.assign((dump) => new ReadableStream({
        start(controller) {
          for (const id of dump.ids) controller.enqueue(encoder.encode(id + '\\n'));
          controller.close();
        },
      }), { contentType: 'text/plain; charset=utf-8', extension: 'txt' }));
    }
  `);

  const runtime = await loadUnifiedPlugins({ dirs: [tmp] });
  await runtime.init();

  const registered = getExportFormat('codex9-lines');
  expect(runtime.pluginRegistry()[0].surfaces).toContain('exportFormats');
  expect(registered?.contentType).toBe('text/plain; charset=utf-8');
  expect(registered?.extension).toBe('txt');
  const body = await new Response(registered!({
    ids: ['alpha', 'beta'],
    embeddings: [],
    metadatas: [],
    documents: [],
  })).text();
  expect(body).toBe('alpha\nbeta\n');
});
