import { listCanvasPlugins, type CanvasPluginDescriptor, type CanvasPluginKind } from './plugins.ts';
import { canvasRegistry } from './registry.ts';
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

export interface CanvasPluginMetadataRegistry {
  kind: 'canvas';
  count: number;
  plugins: CanvasPluginMetadataEntry[];
  standalone: ReturnType<typeof canvasRegistry>['standalone'];
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

export function canvasPluginMetadataRegistry(): CanvasPluginMetadataRegistry {
  const metadata = listCanvasPluginMetadata();
  return { ...metadata, count: metadata.plugins.length, standalone: canvasRegistry().standalone };
}
