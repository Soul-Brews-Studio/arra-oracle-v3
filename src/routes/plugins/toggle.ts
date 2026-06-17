import { Elysia, t } from 'elysia';
import type { UnifiedRuntime } from '../../plugins/unified-loader.ts';
import { sanitizePluginName } from './model.ts';
import { readPluginEnabled, writePluginEnabled } from './state.ts';

export interface PluginToggleRouteOptions {
  runtime?: Pick<UnifiedRuntime, 'mcpTools' | 'reload'>;
}

type ToggleBody = { enabled?: boolean } | undefined;

function mcpToolNames(runtime: Pick<UnifiedRuntime, 'mcpTools'>, plugin: string): string[] {
  return runtime.mcpTools
    .filter((tool) => tool.plugin === plugin)
    .map((tool) => tool.name)
    .sort();
}

export function createPluginToggleRoute(options: PluginToggleRouteOptions = {}) {
  return new Elysia().post(
    '/api/plugins/:name/toggle',
    async ({ params, body, set }) => {
      if (!options.runtime) {
        set.status = 503;
        return { ok: false, error: 'plugin runtime unavailable' };
      }
      const requested = (body as ToggleBody)?.enabled;
      const current = readPluginEnabled(params.name);
      const nextEnabled = requested ?? !(current ?? true);
      const result = writePluginEnabled(params.name, nextEnabled);
      if (!result) {
        set.status = 404;
        return { ok: false, error: 'plugin manifest not found', name: sanitizePluginName(params.name) };
      }
      try {
        await options.runtime.reload();
      } catch (error) {
        set.status = 500;
        return {
          ok: false,
          plugin: result.name,
          enabled: result.enabled,
          error: 'plugin runtime reload failed',
          message: error instanceof Error ? error.message : String(error),
        };
      }
      const mcpTools = mcpToolNames(options.runtime, result.name);
      return { ok: true, plugin: result.name, enabled: result.enabled, reloaded: true, mcpTools, mcpToolCount: mcpTools.length };
    },
    {
      params: t.Object({ name: t.String({ minLength: 1 }) }),
      body: t.Optional(t.Object({ enabled: t.Optional(t.Boolean()) })),
      detail: { tags: ['plugins'], summary: 'Enable or disable a plugin and reload runtime MCP tools' },
    },
  );
}
