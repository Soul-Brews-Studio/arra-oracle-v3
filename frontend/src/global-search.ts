import { fetchMcpTools, fetchMenu, fetchPlugins } from './api';
import { surfacesFor } from './plugin-surfaces';
import { mcpToolPath, pluginInventoryPath } from './routePaths';
import type { McpTool, MenuItem, PluginEntry } from './types';

export type GlobalSearchSurface = 'menu' | 'plugin' | 'mcp-tool';

export type GlobalSearchResult = {
  id: string;
  surface: GlobalSearchSurface;
  title: string;
  detail: string;
  href?: string;
  keywords: string;
};

type GlobalSearchSources = {
  menu: MenuItem[];
  plugins: PluginEntry[];
  tools: McpTool[];
};

const surfaceLabels: Record<GlobalSearchSurface, string> = {
  menu: 'Menu',
  plugin: 'Plugin',
  'mcp-tool': 'MCP tool',
};

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function menuSourceLabel(item: MenuItem): string {
  if (item.sourceName) return `${item.source ?? 'source'}:${item.sourceName}`;
  return item.source ?? 'api';
}

function toolSourceLabel(tool: McpTool): string {
  if (tool.source === 'plugin' || tool.plugin) return tool.plugin ? `plugin:${tool.plugin}` : 'plugin';
  return tool.source ?? 'core';
}

function haystack(result: GlobalSearchResult): string {
  return `${result.title} ${result.detail} ${result.keywords}`.toLowerCase();
}

function menuResult(item: MenuItem): GlobalSearchResult {
  return {
    id: `menu:${item.path}:${item.label}`,
    surface: 'menu',
    title: item.label,
    detail: `${item.path} · ${item.group ?? 'tools'} · ${menuSourceLabel(item)}`,
    href: item.path,
    keywords: [item.icon, item.source, item.sourceName, item.order].map(text).join(' '),
  };
}

function pluginResult(plugin: PluginEntry): GlobalSearchResult {
  const surfaces = surfacesFor(plugin);
  const server = plugin.server ? `${plugin.server.command} ${(plugin.server.args ?? []).join(' ')}` : '';
  const tools = plugin.mcpTools?.map((tool) => tool.name).join(' ') ?? '';
  const detail = plugin.description || `Plugin manifest${plugin.version ? ` · ${plugin.version}` : ''}`;
  return {
    id: `plugin:${plugin.name}`,
    surface: 'plugin',
    title: plugin.name,
    detail: surfaces.length ? `${detail} · ${surfaces.join(', ')}` : detail,
    href: pluginInventoryPath({ q: plugin.name }),
    keywords: [plugin.file, plugin.version, plugin.menu?.label, server, tools, surfaces.join(' ')].map(text).join(' '),
  };
}

function toolResult(tool: McpTool): GlobalSearchResult {
  const mode = tool.readOnly === true ? 'read-only' : tool.readOnly === false ? 'write' : '';
  return {
    id: `mcp:${tool.source ?? 'core'}:${tool.name}`,
    surface: 'mcp-tool',
    title: tool.name,
    detail: `${tool.description || 'No description supplied.'} · ${toolSourceLabel(tool)}`,
    href: mcpToolPath(tool.name),
    keywords: [tool.group, tool.plugin, tool.source, mode].map(text).join(' '),
  };
}

export function globalSearchSurfaceLabel(surface: GlobalSearchSurface): string {
  return surfaceLabels[surface];
}

export function buildGlobalSearchResults(sources: GlobalSearchSources, query: string): GlobalSearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return [
    ...sources.menu.map(menuResult),
    ...sources.plugins.map(pluginResult),
    ...sources.tools.map(toolResult),
  ].filter((result) => haystack(result).includes(q)).slice(0, 12);
}

export async function searchAllSurfaces(query: string): Promise<GlobalSearchResult[]> {
  const [menu, plugins, tools] = await Promise.all([fetchMenu(), fetchPlugins(), fetchMcpTools()]);
  return buildGlobalSearchResults({ menu: menu.items, plugins: plugins.plugins, tools: tools.tools }, query);
}
