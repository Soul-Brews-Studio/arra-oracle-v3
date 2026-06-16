export type CanvasPluginKind = 'three' | 'react';

interface BaseCanvasPlugin {
  id: string;
  label: string;
  description: string;
  path: string;
  query: { plugin: string };
}

export interface ThreeCanvasPlugin extends BaseCanvasPlugin {
  kind: 'three';
  mount: string;
}

export interface ReactCanvasPlugin extends BaseCanvasPlugin {
  kind: 'react';
  renderer: string;
  apiPath?: string;
}

export type CanvasPluginDescriptor = ThreeCanvasPlugin | ReactCanvasPlugin;

const THREE_PLUGINS: readonly ThreeCanvasPlugin[] = [
  { id: 'cube', label: 'Cube', description: 'Rotating geometry scene.', kind: 'three', mount: 'cubeScene', path: '/canvas', query: { plugin: 'cube' } },
  { id: 'galaxy', label: 'Galaxy', description: 'Particle galaxy scene.', kind: 'three', mount: 'galaxyScene', path: '/canvas', query: { plugin: 'galaxy' } },
  { id: 'torus', label: 'Torus', description: 'Torus knot scene.', kind: 'three', mount: 'torusScene', path: '/canvas', query: { plugin: 'torus' } },
  { id: 'graph3d', label: 'Graph 3D', description: 'Three-dimensional graph scene.', kind: 'three', mount: 'graph3dScene', path: '/canvas', query: { plugin: 'graph3d' } },
  { id: 'solar', label: 'Solar', description: 'Solar orbit scene.', kind: 'three', mount: 'solarScene', path: '/canvas', query: { plugin: 'solar' } },
  { id: 'wave', label: 'Wave', description: 'Wave field scene.', kind: 'three', mount: 'waveScene', path: '/canvas', query: { plugin: 'wave' } },
  { id: 'map3d', label: 'Map 3D', description: 'Legacy 3D knowledge map scene.', kind: 'three', mount: 'map3dScene', path: '/canvas', query: { plugin: 'map3d' } },
];

const REACT_PLUGINS: readonly ReactCanvasPlugin[] = [
  { id: 'map', label: 'Knowledge Map', description: 'React knowledge-map canvas backed by /api/map3d.', kind: 'react', renderer: 'KnowledgeMapCanvas', path: '/map', query: { plugin: 'map' }, apiPath: '/api/map3d' },
  { id: 'planets', label: 'Planets', description: 'React orbital canvas view.', kind: 'react', renderer: 'PlanetsCanvas', path: '/planets', query: { plugin: 'planets' }, apiPath: '/api/map3d' },
];

export const CANVAS_PLUGINS: readonly CanvasPluginDescriptor[] = [...THREE_PLUGINS, ...REACT_PLUGINS];

export function listCanvasPlugins(kind?: CanvasPluginKind): CanvasPluginDescriptor[] {
  return kind ? CANVAS_PLUGINS.filter((plugin) => plugin.kind === kind) : [...CANVAS_PLUGINS];
}

export function findCanvasPlugin(id: string): CanvasPluginDescriptor | undefined {
  return CANVAS_PLUGINS.find((plugin) => plugin.id === id);
}
