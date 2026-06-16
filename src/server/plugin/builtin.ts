import { Elysia } from 'elysia';

import { createUnifiedManifestServerPlugins } from './unified.ts';
import type { ServerPlugin } from './types.ts';

import { authRoutes } from '../../routes/auth/index.ts';
import { settingsRoutes } from '../../routes/settings/index.ts';
import { feedRoutes } from '../../routes/feed/index.ts';
import { healthRoutes } from '../../routes/health/index.ts';
import { dashboardRoutes } from '../../routes/dashboard/index.ts';
import { searchRoutes } from '../../routes/search/index.ts';
import { conceptsRoutes } from '../../routes/concepts/index.ts';
import { verifyRoutes } from '../../routes/verify/index.ts';
import { vectorRoutes } from '../../routes/vector/index.ts';
import { knowledgeRoutes } from '../../routes/knowledge/index.ts';
import { supersedeRoutes } from '../../routes/supersede/index.ts';
import { forumApi } from '../../routes/forum/index.ts';
import { tracesApi } from '../../routes/traces/index.ts';
import { scheduleApi } from '../../routes/schedule/index.ts';
import { filesRouter } from '../../routes/files/index.ts';
import { pluginsRouter } from '../../routes/plugins/index.ts';
import { sessionsRoutes } from '../../routes/sessions/index.ts';
import { vaultRoutes } from '../../routes/vault/index.ts';
import { createMenuRoutes } from '../../routes/menu/index.ts';
import { gatewayPlugin } from '../../gateway/index.ts';

interface BuiltinOptions {
  dataDir: string;
  vectorUrl?: string;
}

function routePlugin(
  name: string,
  tier: ServerPlugin['tier'],
  routes: ServerPlugin['routes'],
  seedMenu = true,
): ServerPlugin {
  return { name, tier, routes, seedMenu };
}

async function optionalIndexerPlugin(): Promise<ServerPlugin | null> {
  try {
    const { indexerRoutes } = await import('../../routes/indexer/index.ts');
    return routePlugin('indexer', 'core', () => indexerRoutes);
  } catch {
    console.log('[Indexer] Routes not loaded — indexer is optional');
    return null;
  }
}

export function createApiManifestExamplePlugin(): ServerPlugin {
  return {
    name: 'plugin-api-example',
    tier: 'extra',
    enabled: false,
    seedMenu: false,
    api: { path: '/api/plugin-example', methods: ['GET'] },
    routes: () => new Elysia().get('/', () => ({
      ok: true,
      plugin: 'plugin-api-example',
      mountedBy: 'server-plugin-api-manifest',
    })),
  };
}

export async function createBuiltinServerPlugins(options: BuiltinOptions): Promise<ServerPlugin[]> {
  const gatewayRoutes = gatewayPlugin(options.dataDir, options.vectorUrl);
  const menuRoutes = createMenuRoutes();
  const indexerPlugin = await optionalIndexerPlugin();
  const unifiedManifestPlugins = await createUnifiedManifestServerPlugins();
  const plugins: Array<ServerPlugin | null> = [
    routePlugin('gateway', 'standard', () => gatewayRoutes, false),
    createApiManifestExamplePlugin(),
    routePlugin('health', 'core', () => healthRoutes),
    routePlugin('search', 'core', () => searchRoutes),
    routePlugin('knowledge', 'core', () => knowledgeRoutes),
    routePlugin('concepts', 'core', () => conceptsRoutes),
    routePlugin('verify', 'core', () => verifyRoutes),
    routePlugin('vector', 'core', () => vectorRoutes),
    routePlugin('files', 'core', () => filesRouter),
    indexerPlugin,
    routePlugin('auth', 'standard', () => authRoutes),
    routePlugin('settings', 'standard', () => settingsRoutes),
    routePlugin('feed', 'standard', () => feedRoutes),
    routePlugin('dashboard', 'standard', () => dashboardRoutes),
    routePlugin('supersede', 'standard', () => supersedeRoutes),
    routePlugin('forum', 'standard', () => forumApi),
    routePlugin('traces', 'standard', () => tracesApi),
    routePlugin('schedule', 'standard', () => scheduleApi),
    routePlugin('plugins', 'standard', () => pluginsRouter),
    routePlugin('sessions', 'standard', () => sessionsRoutes),
    routePlugin('vault', 'standard', () => vaultRoutes),
    routePlugin('menu', 'standard', () => menuRoutes, false),
  ];

  return [
    ...plugins.filter((plugin): plugin is ServerPlugin => Boolean(plugin)),
    ...unifiedManifestPlugins,
  ];
}
