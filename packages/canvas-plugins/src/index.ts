export const CANVAS_HOST = 'canvas.buildwithoracle.com';
export const CANVAS_ORIGIN = `https://${CANVAS_HOST}`;
export const DEFAULT_CANVAS_PLUGIN = 'wave';

export type CanvasPluginKind = 'three' | 'react';
export type ThreeCanvasMount = 'cubeScene' | 'galaxyScene' | 'torusScene' | 'graph3dScene' | 'solarScene' | 'waveScene' | 'map3dScene';
export type ReactCanvasRenderer = 'KnowledgeMapCanvas' | 'PlanetsCanvas';

interface BaseCanvasPlugin {
  id: string;
  label: string;
  description: string;
  path: string;
  query: { plugin: string };
}

export interface CanvasThreePlugin extends BaseCanvasPlugin {
  kind: 'three';
  mount: ThreeCanvasMount;
}

export interface CanvasReactPlugin extends BaseCanvasPlugin {
  kind: 'react';
  renderer: ReactCanvasRenderer;
  apiPath: string;
}

export type CanvasPlugin = CanvasThreePlugin | CanvasReactPlugin;
export type CanvasPluginDescriptor = CanvasPlugin;
export type CanvasPluginRenderer = 'Three' | 'React';

export type CanvasRegistryPlugin = CanvasPlugin & { standalonePath: string };

export interface CanvasStandaloneRegistry {
  host: string;
  defaultPlugin: string;
  serveCommand: string;
}

export interface CanvasPluginRegistry {
  plugins: CanvasRegistryPlugin[];
  count: number;
  kind: CanvasPluginKind | 'all';
  standalone: CanvasStandaloneRegistry;
}

export interface CanvasPluginMetadataEntry {
  id: string;
  label: string;
  kind: CanvasPluginKind;
  renderer: CanvasPluginRenderer;
  description?: string;
  standalonePath?: string;
  apiPath?: string;
}

export interface CanvasPluginMetadataRegistry {
  kind: 'canvas';
  count: number;
  plugins: CanvasPluginMetadataEntry[];
  standalone: CanvasStandaloneRegistry;
}

export const CANVAS_THREE_PLUGINS: readonly CanvasThreePlugin[] = [
  { id: 'cube', label: 'Cube', description: 'Rotating geometry scene.', kind: 'three', mount: 'cubeScene', path: '/canvas', query: { plugin: 'cube' } },
  { id: 'galaxy', label: 'Galaxy', description: 'Particle galaxy scene.', kind: 'three', mount: 'galaxyScene', path: '/canvas', query: { plugin: 'galaxy' } },
  { id: 'torus', label: 'Torus', description: 'Torus knot scene.', kind: 'three', mount: 'torusScene', path: '/canvas', query: { plugin: 'torus' } },
  { id: 'graph3d', label: 'Graph 3D', description: 'Three-dimensional graph scene.', kind: 'three', mount: 'graph3dScene', path: '/canvas', query: { plugin: 'graph3d' } },
  { id: 'solar', label: 'Solar', description: 'Solar orbit scene.', kind: 'three', mount: 'solarScene', path: '/canvas', query: { plugin: 'solar' } },
  { id: 'wave', label: 'Wave', description: 'Wave field scene.', kind: 'three', mount: 'waveScene', path: '/canvas', query: { plugin: 'wave' } },
  { id: 'map3d', label: 'Map 3D', description: 'Legacy 3D knowledge map scene.', kind: 'three', mount: 'map3dScene', path: '/canvas', query: { plugin: 'map3d' } },
];

export const CANVAS_REACT_PLUGINS: readonly CanvasReactPlugin[] = [
  { id: 'map', label: 'Knowledge Map', description: 'React knowledge-map canvas backed by /api/map3d.', kind: 'react', renderer: 'KnowledgeMapCanvas', path: '/map', query: { plugin: 'map' }, apiPath: '/api/map3d' },
  { id: 'planets', label: 'Planets', description: 'React orbital canvas view.', kind: 'react', renderer: 'PlanetsCanvas', path: '/planets', query: { plugin: 'planets' }, apiPath: '/api/map3d' },
];

export const CANVAS_PLUGINS: readonly CanvasPlugin[] = [...CANVAS_THREE_PLUGINS, ...CANVAS_REACT_PLUGINS];

const kinds = new Set<CanvasPluginKind>(['three', 'react']);

function cloneCanvasPlugin(plugin: CanvasPlugin): CanvasPlugin {
  return { ...plugin, query: { ...plugin.query } };
}

export function parseCanvasKind(value: unknown): CanvasPluginKind | undefined {
  const kind = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return kinds.has(kind as CanvasPluginKind) ? kind as CanvasPluginKind : undefined;
}

export function listCanvasPlugins(kind?: CanvasPluginKind): CanvasPlugin[] {
  const plugins = kind ? CANVAS_PLUGINS.filter((plugin) => plugin.kind === kind) : CANVAS_PLUGINS;
  return plugins.map(cloneCanvasPlugin);
}

export function findCanvasPlugin(id: string): CanvasPlugin | undefined {
  const pluginId = id.trim();
  const plugin = CANVAS_PLUGINS.find((candidate) => candidate.id === pluginId);
  return plugin ? cloneCanvasPlugin(plugin) : undefined;
}

export function canvasPluginPath(id: string): string {
  const pluginId = id.trim() || DEFAULT_CANVAS_PLUGIN;
  const plugin = findCanvasPlugin(pluginId);
  if (plugin?.kind === 'react') return `/${plugin.id}`;
  return `/?${new URLSearchParams({ plugin: pluginId })}`;
}

export function canvasPluginAbsoluteUrl(id: string, origin = CANVAS_ORIGIN): string {
  return new URL(canvasPluginPath(id), origin).toString();
}

export function canvasPluginDataPath(id: string): string | undefined {
  const plugin = findCanvasPlugin(id);
  return plugin?.kind === 'react' ? plugin.apiPath : undefined;
}

function standalone(): CanvasStandaloneRegistry {
  return {
    host: CANVAS_HOST,
    defaultPlugin: DEFAULT_CANVAS_PLUGIN,
    serveCommand: 'bun run src/cli/index.ts canvas-serve --port 47779',
  };
}

export function canvasRegistry(kind?: CanvasPluginKind): CanvasPluginRegistry {
  const plugins = listCanvasPlugins(kind).map((plugin) => ({ ...plugin, standalonePath: canvasPluginPath(plugin.id) }));
  return { plugins, count: plugins.length, kind: kind ?? 'all', standalone: standalone() };
}

export function canvasPluginEntry(id: string): { plugin: CanvasRegistryPlugin } | null {
  const plugin = findCanvasPlugin(id);
  return plugin ? { plugin: { ...plugin, standalonePath: canvasPluginPath(plugin.id) } } : null;
}

function rendererFor(kind: CanvasPluginKind): CanvasPluginRenderer {
  return kind === 'three' ? 'Three' : 'React';
}

function metadataFromPlugin(plugin: CanvasPlugin): CanvasPluginMetadataEntry {
  return { id: plugin.id, label: plugin.label, kind: plugin.kind, renderer: rendererFor(plugin.kind), description: plugin.description };
}

export const CANVAS_PLUGIN_METADATA: CanvasPluginMetadataEntry[] = listCanvasPlugins().map(metadataFromPlugin);

export function listCanvasPluginMetadata(): { kind: 'canvas'; plugins: CanvasPluginMetadataEntry[] } {
  return {
    kind: 'canvas',
    plugins: listCanvasPlugins().map((plugin) => ({
      ...metadataFromPlugin(plugin),
      standalonePath: canvasPluginPath(plugin.id),
      apiPath: canvasPluginDataPath(plugin.id),
    })),
  };
}

export function canvasPluginMetadataRegistry(): CanvasPluginMetadataRegistry {
  const metadata = listCanvasPluginMetadata();
  return { ...metadata, count: metadata.plugins.length, standalone: standalone() };
}
