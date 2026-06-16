import { pathToFileURL } from 'node:url';

import { registerExportFormat, type ExportFormatter } from '../vector/export-formats.ts';
import { runPluginWithErrorContainment } from './error-containment.ts';
import type { NormalizedUnifiedPluginManifest } from './unified-manifest.ts';

interface ExportFormatPlugin {
  manifest: NormalizedUnifiedPluginManifest;
  entryPath: string;
}

interface ExportFormatContext {
  source: 'exportFormat';
  plugin: string;
  format: string;
  config: unknown;
  registerExportFormat: typeof registerExportFormat;
}

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('handler timed out')), ms));
}

async function invokeFormat(plugin: ExportFormatPlugin, format: string, handler: string, timeoutMs: number) {
  const mod = await import(pathToFileURL(plugin.entryPath).href);
  const fn = handler === 'default' ? mod.default : (mod[handler] ?? mod.default);
  if (typeof fn !== 'function') throw new Error(`handler not found: ${handler}`);
  const ctx: ExportFormatContext = {
    source: 'exportFormat',
    plugin: plugin.manifest.name,
    format,
    config: plugin.manifest.config ?? {},
    registerExportFormat,
  };
  return Promise.race([Promise.resolve(fn(ctx)), timeout(timeoutMs)]);
}

export async function registerPluginExportFormats(
  plugin: ExportFormatPlugin,
  timeoutMs: number,
): Promise<string | undefined> {
  for (const format of plugin.manifest.exportFormats) {
    const result = await runPluginWithErrorContainment({
      plugin: plugin.manifest.name,
      phase: 'init',
    }, () => invokeFormat(plugin, format.name, format.handler, timeoutMs));
    if (!result.ok) return result.error;
    if (typeof result.value === 'function') {
      registerExportFormat(format.name, result.value as ExportFormatter);
    }
  }
}
