import type { CanvasPlugin, CanvasPluginCleanup, CanvasReactPlugin, CanvasThreePlugin } from './plugin.ts';
import { isCanvasPlugin } from './plugin.ts';

export interface CanvasPluginHostAdapters {
  mountThree: (plugin: CanvasThreePlugin) => CanvasPluginCleanup | Promise<CanvasPluginCleanup>;
  renderReact: (plugin: CanvasReactPlugin) => CanvasPluginCleanup | Promise<CanvasPluginCleanup>;
}

export async function renderCanvasPlugin(
  plugin: CanvasPlugin,
  adapters: CanvasPluginHostAdapters,
): Promise<Exclude<CanvasPluginCleanup, void> | undefined> {
  if (!isCanvasPlugin(plugin)) {
    throw new Error('Invalid CanvasPlugin: expected a three mount or react renderer');
  }

  const cleanup = plugin.kind === 'three'
    ? await adapters.mountThree(plugin)
    : await adapters.renderReact(plugin);

  return typeof cleanup === 'function' ? cleanup : undefined;
}
