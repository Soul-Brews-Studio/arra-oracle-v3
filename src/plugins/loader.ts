import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { LoadedPlugin, PluginManifest, PluginRegistry, PluginType } from './types';

const MANIFEST_FILE = 'plugin.json';
const DEFAULT_PLUGIN_DIR = join(process.env.HOME || '~', '.oracle', 'plugins');

function pluginDirs(): string[] {
  const extra = process.env.ORACLE_PLUGIN_DIRS?.split(',').map((d) => d.trim()).filter(Boolean) ?? [];
  return [DEFAULT_PLUGIN_DIR, ...extra];
}

function readManifest(dir: string): PluginManifest | null {
  const file = join(dir, MANIFEST_FILE);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as PluginManifest;
  } catch {
    console.warn(`[plugins] invalid manifest: ${file}`);
    return null;
  }
}

function discoverPlugins(): Array<{ manifest: PluginManifest; dir: string }> {
  const found: Array<{ manifest: PluginManifest; dir: string }> = [];
  const seen = new Set<string>();
  for (const base of pluginDirs()) {
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = resolve(base, entry.name);
      const manifest = readManifest(dir);
      if (!manifest || seen.has(manifest.name)) continue;
      if (manifest.enabled === false) continue;
      seen.add(manifest.name);
      found.push({ manifest, dir });
    }
  }
  return found;
}

async function loadHttpPlugin(plugin: LoadedPlugin): Promise<void> {
  if (plugin.manifest.type !== 'http') return;
  const m = plugin.manifest;
  plugin.port = m.port;
  if (m.startup) {
    const proc = Bun.spawn([m.startup.command, ...(m.startup.args ?? [])], {
      cwd: plugin.dir,
      env: { ...process.env, ...(m.startup.env ?? {}) },
      stdout: 'ignore',
      stderr: 'ignore',
    });
    plugin.pid = proc.pid;
  }
  const healthUrl = `http://localhost:${m.port}${m.healthPath ?? '/health'}`;
  for (let i = 0; i < 10; i++) {
    try {
      const res = await fetch(healthUrl, { signal: AbortSignal.timeout(2000) });
      if (res.ok) { plugin.status = 'healthy'; return; }
    } catch {}
    await Bun.sleep(1000);
  }
  plugin.status = 'degraded';
  plugin.error = `health check failed: ${healthUrl}`;
}

async function loadSubprocessPlugin(plugin: LoadedPlugin): Promise<void> {
  if (plugin.manifest.type !== 'subprocess') return;
  const m = plugin.manifest;
  try {
    const proc = Bun.spawn([m.command, ...(m.args ?? [])], {
      cwd: plugin.dir,
      env: { ...process.env, ...(m.env ?? {}) },
      stdin: 'pipe',
      stdout: 'pipe',
    });
    plugin.pid = proc.pid;
    plugin.status = 'healthy';
  } catch (err) {
    plugin.status = 'error';
    plugin.error = String(err);
  }
}

async function loadFfiPlugin(plugin: LoadedPlugin): Promise<void> {
  if (plugin.manifest.type !== 'ffi') return;
  const m = plugin.manifest;
  const libPath = join(plugin.dir, m.library);
  if (!existsSync(libPath)) {
    plugin.status = 'error';
    plugin.error = `library not found: ${libPath}`;
    return;
  }
  plugin.status = 'healthy';
}

async function loadJsPlugin(plugin: LoadedPlugin): Promise<void> {
  if (plugin.manifest.type !== 'js') return;
  const m = plugin.manifest;
  try {
    await import(join(plugin.dir, m.main));
    plugin.status = 'healthy';
  } catch (err) {
    plugin.status = 'error';
    plugin.error = String(err);
  }
}

const loaders: Record<PluginType, (p: LoadedPlugin) => Promise<void>> = {
  js: loadJsPlugin,
  http: loadHttpPlugin,
  subprocess: loadSubprocessPlugin,
  ffi: loadFfiPlugin,
};

export async function loadPlugins(): Promise<PluginRegistry> {
  const discovered = discoverPlugins();
  const plugins: LoadedPlugin[] = discovered.map(({ manifest, dir }) => ({
    manifest,
    dir,
    status: 'loading',
  }));

  const order: PluginType[] = ['js', 'subprocess', 'http', 'ffi'];
  for (const type of order) {
    const batch = plugins.filter((p) => p.manifest.type === type);
    await Promise.all(batch.map((p) => loaders[p.manifest.type](p).catch((err) => {
      p.status = 'error';
      p.error = String(err);
    })));
  }

  const byName = new Map(plugins.map((p) => [p.manifest.name, p]));
  return {
    plugins,
    getByName: (name) => byName.get(name),
    getByType: (type) => plugins.filter((p) => p.manifest.type === type),
  };
}
