import { listCanvasPlugins, type CanvasPluginDescriptor, type CanvasPluginKind } from './plugins.ts';
import { canvasPluginDataPath, canvasPluginPath } from './urls.ts';

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

function rendererFor(kind: CanvasPluginKind): CanvasPluginRenderer {
  return kind === 'three' ? 'Three' : 'React';
}

function metadataFromPlugin(plugin: CanvasPluginDescriptor): CanvasPluginMetadataEntry {
  return {
    id: plugin.id,
    label: plugin.label,
    kind: plugin.kind,
    renderer: rendererFor(plugin.kind),
    description: plugin.description,
  };
}

export const CANVAS_PLUGIN_METADATA: CanvasPluginMetadataEntry[] = listCanvasPlugins().map(metadataFromPlugin);

export function listCanvasPluginMetadata(): { kind: 'canvas'; plugins: CanvasPluginMetadataEntry[] } {
  return {
    kind: 'canvas',
    plugins: listCanvasPlugins().map((plugin) => ({
      ...metadataFromPlugin(plugin),
      standalonePath: canvasPluginPath(plugin.id),
      apiPath: canvasPluginDataPath(plugin.id) ?? ('apiPath' in plugin ? plugin.apiPath : undefined),
    })),
  };
}
