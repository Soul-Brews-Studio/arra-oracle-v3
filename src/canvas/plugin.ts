/**
 * Frontend renderer plugin contract for canvas surfaces.
 *
 * Naming guardrail: CanvasPlugin is not the server-side ServerPlugin and not
 * the local InstalledPlugin/WasmPlugin exposed by /api/plugins. Canvas plugins
 * are bundled frontend renderers selected by canvas hosts such as /canvas or a
 * future canvas.buildwithoracle.com app.
 */
export type CanvasPluginKind = 'three' | 'react';

export interface CanvasPluginMetadata {
  /** Stable URL/config identifier, for example /canvas?plugin=wave. */
  id: string;
  /** Human-readable picker label. */
  label: string;
  /** Optional short explanation for plugin lists and docs. */
  description?: string;
  /** Optional grouping/search metadata. */
  tags?: string[];
}

export interface CanvasMountTarget {
  /** Host element supplied by the canvas runtime. Frontend apps may narrow this to HTMLElement. */
  element: unknown;
  /** Optional AbortSignal for teardown-aware renderers. */
  signal?: AbortSignal;
}

export type CanvasPluginCleanup = void | (() => void | Promise<void>);

export type CanvasSceneMount = (target: CanvasMountTarget) => CanvasPluginCleanup | Promise<CanvasPluginCleanup>;

export type CanvasReactRenderer<Props extends Record<string, unknown> = Record<string, unknown>> = (
  props: Props,
) => unknown;

export type CanvasThreePlugin = CanvasPluginMetadata & {
  kind: 'three';
  mount: CanvasSceneMount;
};

export type CanvasReactPlugin<Props extends Record<string, unknown> = Record<string, unknown>> =
  CanvasPluginMetadata & {
    kind: 'react';
    renderer: CanvasReactRenderer<Props>;
  };

export type CanvasPlugin<Props extends Record<string, unknown> = Record<string, unknown>> =
  | CanvasThreePlugin
  | CanvasReactPlugin<Props>;

export function isCanvasPlugin(value: unknown): value is CanvasPlugin {
  if (!value || typeof value !== 'object') return false;
  const plugin = value as Partial<CanvasPlugin>;
  if (typeof plugin.id !== 'string' || plugin.id.trim().length === 0) return false;
  if (typeof plugin.label !== 'string' || plugin.label.trim().length === 0) return false;
  if (plugin.kind === 'three') return typeof plugin.mount === 'function';
  if (plugin.kind === 'react') return typeof plugin.renderer === 'function';
  return false;
}
