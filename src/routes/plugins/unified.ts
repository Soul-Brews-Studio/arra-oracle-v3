import { pathToFileURL } from 'node:url';

import { Elysia } from 'elysia';

import {
  discoverUnifiedPluginManifests,
  type LoadedUnifiedPluginManifest,
} from '../../plugins/unified-loader.ts';
import type { UnifiedApiRouteManifest } from '../../plugins/unified-manifest.ts';
import type { MenuItem } from '../menu/model.ts';

export interface UnifiedPluginRouteOptions {
  plugins?: LoadedUnifiedPluginManifest[];
  warn?: (message: string) => void;
}

type ElysiaContext = {
  request: Request;
  params: Record<string, string>;
  query: Record<string, unknown>;
  body?: unknown;
  set: { status?: number; headers: Record<string, string> };
};

type HandlerResult = Response | Record<string, unknown> | unknown;

type UnifiedHandlerContext = ElysiaContext & {
  plugin: LoadedUnifiedPluginManifest;
  route: UnifiedApiRouteManifest;
};

function methodsFor(route: UnifiedApiRouteManifest): string[] {
  return (route.methods?.length ? route.methods : ['GET']).map((method) => method.toUpperCase());
}

async function invokeHandler(
  plugin: LoadedUnifiedPluginManifest,
  route: UnifiedApiRouteManifest,
  context: ElysiaContext,
): Promise<HandlerResult> {
  if (!route.handler) {
    return { ok: true, plugin: plugin.manifest.name, route: route.path };
  }

  const mod = await import(pathToFileURL(plugin.entryPath).href);
  const handler = route.handler === 'default' ? mod.default : mod[route.handler];
  if (typeof handler !== 'function') {
    context.set.status = 500;
    return { ok: false, error: `missing handler ${route.handler}` };
  }

  return handler({ ...context, plugin, route } satisfies UnifiedHandlerContext);
}

function handleRoute(plugin: LoadedUnifiedPluginManifest, route: UnifiedApiRouteManifest) {
  return async (context: ElysiaContext): Promise<HandlerResult> => {
    try {
      return await invokeHandler(plugin, route, context);
    } catch (error) {
      context.set.status = 500;
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
}

export function createUnifiedPluginApiRoutes(
  options: UnifiedPluginRouteOptions = {},
) {
  const app = new Elysia();
  const plugins = options.plugins ?? discoverUnifiedPluginManifests({ warn: options.warn });
  for (const plugin of plugins) {
    for (const route of plugin.manifest.apiRoutes) {
      const handler = handleRoute(plugin, route) as any;
      for (const method of methodsFor(route)) {
        if (method === 'ALL') app.all(route.path, handler);
        else (app as any).route(method, route.path, handler);
      }
    }
  }
  return app;
}

export function unifiedPluginMenuItems(
  plugins = discoverUnifiedPluginManifests(),
): MenuItem[] {
  return plugins.flatMap(({ manifest }) =>
    manifest.menu.map((item) => ({
      label: item.label,
      path: item.path,
      group: item.group ?? 'tools',
      order: item.order ?? 999,
      icon: item.icon,
      source: 'plugin' as const,
      sourceName: manifest.name,
    })),
  );
}
