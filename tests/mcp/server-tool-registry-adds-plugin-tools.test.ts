import { expect, test } from 'bun:test';
import { createUnifiedRuntimeRef } from '../../src/plugins/runtime-routes.ts';
import type { PluginManifestWatcherOptions } from '../../src/plugins/watcher.ts';
import { runtimeReturning } from './support/plugin-runtime.ts';
import { withProxyServer } from './support/server.ts';

test('MCP server registry adds non-reserved plugin MCP tools', async () => {
  const server = withProxyServer({ unifiedRuntime: runtimeReturning('ok') });
  try {
    const registry = await (server as any).toolRegistry();
    expect(registry.has('demo_tool')).toBe(true);
  } finally {
    await server.cleanup();
  }
});

test('MCP server registry re-reads plugin MCP tools after runtime ref reload', async () => {
  const runtimeRef = createUnifiedRuntimeRef(runtimeReturning('ok', { name: 'before_reload' }));
  const server = withProxyServer({ unifiedRuntimeRef: runtimeRef });
  try {
    expect((await (server as any).toolRegistry()).has('before_reload')).toBe(true);
    runtimeRef.current = runtimeReturning('ok', { name: 'after_reload' });
    const registry = await (server as any).toolRegistry();
    expect(registry.has('after_reload')).toBe(true);
    expect(registry.has('before_reload')).toBe(false);
  } finally {
    await server.cleanup();
  }
});

test('MCP server watcher reload re-merges plugin MCP tools into stdio registry', async () => {
  const previous = process.env.ARRA_PLUGIN_HOT_RELOAD;
  process.env.ARRA_PLUGIN_HOT_RELOAD = '1';
  let onReload: PluginManifestWatcherOptions['onReload'] | null = null;
  const server = withProxyServer({
    unifiedRuntime: runtimeReturning('ok', { name: 'seed_tool' }),
    watchPlugins: (options) => {
      onReload = options.onReload;
      return { close: () => {}, reload: async () => runtimeReturning('ok') };
    },
  });
  try {
    await onReload?.(runtimeReturning('ok', { name: 'watch_reload_tool' }));
    expect((await (server as any).toolRegistry()).has('watch_reload_tool')).toBe(true);
  } finally {
    if (previous === undefined) delete process.env.ARRA_PLUGIN_HOT_RELOAD;
    else process.env.ARRA_PLUGIN_HOT_RELOAD = previous;
    await server.cleanup();
  }
});
