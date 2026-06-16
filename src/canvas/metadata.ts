import type { CanvasPluginKind } from './plugin.ts';

export type CanvasPluginRenderer = 'Three' | 'React';

export interface CanvasPluginMetadataEntry {
  id: string;
  label: string;
  kind: CanvasPluginKind;
  renderer: CanvasPluginRenderer;
  description?: string;
  standalonePath?: string;
  apiPath?: string;
}

export const CANVAS_PLUGIN_METADATA: CanvasPluginMetadataEntry[] = [
  {
    id: 'cube',
    label: 'Cube',
    kind: 'three',
    renderer: 'Three',
    description: 'Bundled Three.js cube scene.',
  },
  {
    id: 'galaxy',
    label: 'Galaxy',
    kind: 'three',
    renderer: 'Three',
    description: 'Bundled Three.js galaxy scene.',
  },
  {
    id: 'torus',
    label: 'Torus',
    kind: 'three',
    renderer: 'Three',
    description: 'Bundled Three.js torus scene.',
  },
  {
    id: 'graph3d',
    label: 'Graph 3D',
    kind: 'three',
    renderer: 'Three',
    description: 'Bundled Three.js graph scene.',
  },
  {
    id: 'solar',
    label: 'Solar',
    kind: 'three',
    renderer: 'Three',
    description: 'Bundled Three.js solar scene.',
  },
  {
    id: 'wave',
    label: 'Wave',
    kind: 'three',
    renderer: 'Three',
    description: 'Bundled Three.js wave scene.',
  },
  {
    id: 'map3d',
    label: 'Map 3D',
    kind: 'three',
    renderer: 'Three',
    description: 'Bundled Three.js map scene.',
  },
  {
    id: 'map',
    label: 'Knowledge Map',
    kind: 'react',
    renderer: 'React',
    description: 'React canvas plugin target for the knowledge map.',
  },
  {
    id: 'planets',
    label: 'Planets',
    kind: 'react',
    renderer: 'React',
    description: 'React canvas plugin target for the planet/orbit view.',
  },
];

function standalonePath(id: string): string {
  return id === 'map' || id === 'planets' ? `/${id}` : `/?plugin=${id}`;
}

function apiPath(id: string): string | undefined {
  return id === 'map' || id === 'planets' ? '/api/map3d' : undefined;
}

export function listCanvasPluginMetadata(): { kind: 'canvas'; plugins: CanvasPluginMetadataEntry[] } {
  return {
    kind: 'canvas',
    plugins: CANVAS_PLUGIN_METADATA.map((plugin) => ({
      ...plugin,
      standalonePath: standalonePath(plugin.id),
      apiPath: apiPath(plugin.id),
    })),
  };
}
