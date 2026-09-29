import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadUnifiedPlugins } from '../../src/plugins/unified-loader.ts';
import { pluginDir } from './_fixtures.ts';

const roots: string[] = [];
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });

describe('private unified plugin policy', () => {
  test('fails closed when exact first-party names are missing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'arra-private-plugin-missing-')); roots.push(root);
    pluginDir(root, 'arra', {});

    await expect(loadUnifiedPlugins({ dirs: [root], strict: { root, requiredNames: ['arra', 'oracle-dig'] } }))
      .rejects.toThrow(/required plugin.*oracle-dig/i);
  });

  test('rejects symlinked plugin directories in strict mode', async () => {
    const root = mkdtempSync(join(tmpdir(), 'arra-private-plugin-link-')); roots.push(root);
    const outside = mkdtempSync(join(tmpdir(), 'arra-private-plugin-outside-')); roots.push(outside);
    pluginDir(root, 'arra', {}); pluginDir(root, 'oracle-dig', {});
    mkdirSync(join(outside, 'shadow')); symlinkSync(join(outside, 'shadow'), join(root, 'shadow'));

    await expect(loadUnifiedPlugins({ dirs: [root], strict: { root, requiredNames: ['arra', 'oracle-dig'] } }))
      .rejects.toThrow(/symlink/i);
  });

  test('rejects symlinked plugin entry paths even when the target stays in-root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'arra-private-plugin-entry-link-')); roots.push(root);
    pluginDir(root, 'arra', {}); pluginDir(root, 'oracle-dig', {});
    const realEntry = join(root, 'oracle-dig', 'real.ts');
    writeFileSync(realEntry, 'export default () => ({ ok: true });');
    rmSync(join(root, 'oracle-dig', 'index.ts'));
    symlinkSync(realEntry, join(root, 'oracle-dig', 'index.ts'));
    writeFileSync(join(root, 'oracle-dig', 'plugin.json'), JSON.stringify({
      name: 'oracle-dig', version: '1.0.0', entry: './index.ts', enabled: true,
    }));

    await expect(loadUnifiedPlugins({ dirs: [root], strict: { root, requiredNames: ['arra', 'oracle-dig'] } }))
      .rejects.toThrow(/symlink/i);
  });

  test('fails lifecycle startup instead of degrading silently', async () => {
    const root = mkdtempSync(join(tmpdir(), 'arra-private-plugin-life-')); roots.push(root);
    pluginDir(root, 'arra', {}); pluginDir(root, 'oracle-dig', { lifecycle: { init: 'init' } }, "export function init() { throw new Error('boom'); }");
    const runtime = await loadUnifiedPlugins({ dirs: [root], strict: { root, requiredNames: ['arra', 'oracle-dig'], failOnLifecycle: true } });

    await expect(runtime.init()).rejects.toThrow(/boom/);
  });

  test('fails closed on duplicate strict plugin names', async () => {
    const root = mkdtempSync(join(tmpdir(), 'arra-private-plugin-duplicates-')); roots.push(root);
    const first = join(root, 'first');
    const second = join(root, 'second');
    mkdirSync(first); mkdirSync(second);
    const manifest = JSON.stringify({ name: 'arra', version: '1.0.0', entry: './index.ts', enabled: true });
    writeFileSync(join(first, 'plugin.json'), manifest); writeFileSync(join(second, 'plugin.json'), manifest);
    writeFileSync(join(first, 'index.ts'), 'export default () => ({ ok: true });');
    writeFileSync(join(second, 'index.ts'), 'export default () => ({ ok: true });');
    await expect(loadUnifiedPlugins({ dirs: [root], strict: { root, requiredNames: ['arra'] } }))
      .rejects.toThrow(/duplicate plugin name/);
  });
});
