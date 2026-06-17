import { join } from "path";
import { homedir } from "os";
import { existsSync, readdirSync } from "fs";
import { parseManifest, validateManifest } from "./manifest.ts";
import type { LoadedPlugin } from "./types.ts";
import {
  discoverUnifiedPluginManifests,
  type LoadedUnifiedPlugin,
} from "../../../src/plugins/unified-loader.ts";
import { resolveContainedPluginEntry } from "../../../src/plugins/path-containment.ts";

const USER_PLUGIN_DIR = join(homedir(), ".arra", "plugins");
const BUNDLED_PLUGIN_DIR = join(import.meta.dir, "..", "plugins");

export interface DiscoverResult {
  plugins: LoadedPlugin[];
  bundled: number;
  user: number;
}

export interface DiscoverOptions {
  unifiedPlugins?: LoadedUnifiedPlugin[];
  userPluginDir?: string;
  bundledPluginDir?: string;
}

async function loadPluginDir(dir: string): Promise<LoadedPlugin | null> {
  const manifestPath = join(dir, "plugin.json");
  if (!existsSync(manifestPath)) return null;
  try {
    const raw = await Bun.file(manifestPath).json();
    const manifest = parseManifest(raw);
    validateManifest(manifest);
    const entryPath = resolveContainedPluginEntry(dir, manifest.entry);
    return { manifest, dir, entryPath };
  } catch {
    return null;
  }
}

function fromUnifiedPlugin(plugin: LoadedUnifiedPlugin): LoadedPlugin {
  const { cli: _cli, api: _api, seedMenu: _seedMenu, ...manifest } =
    plugin.manifest as typeof plugin.manifest & { api?: unknown; cli?: unknown; seedMenu?: unknown };
  return {
    manifest,
    dir: plugin.dir,
    entryPath: plugin.entryPath,
  };
}

export async function discoverPlugins(options: DiscoverOptions = {}): Promise<DiscoverResult> {
  const plugins: LoadedPlugin[] = [];
  const seen = new Set<string>();
  let bundled = 0;
  let user = 0;

  const unifiedPlugins = options.unifiedPlugins ?? await discoverUnifiedPluginManifests();
  for (const plugin of unifiedPlugins) {
    if (seen.has(plugin.manifest.name)) continue;
    seen.add(plugin.manifest.name);
    plugins.push(fromUnifiedPlugin(plugin));
    user++;
  }

  // user plugins scanned first so they override bundled plugins with the same name
  const userDir = options.userPluginDir ?? USER_PLUGIN_DIR;
  const bundledDir = options.bundledPluginDir ?? BUNDLED_PLUGIN_DIR;
  for (const [isUser, baseDir] of [[true, userDir], [false, bundledDir]] as [boolean, string][]) {
    if (!existsSync(baseDir)) continue;
    const entries = readdirSync(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pluginDir = join(baseDir, entry.name);
      const loaded = await loadPluginDir(pluginDir);
      if (!loaded) continue;
      if (seen.has(loaded.manifest.name)) continue;
      seen.add(loaded.manifest.name);
      plugins.push(loaded);
      if (isUser) user++;
      else bundled++;
    }
  }

  return { plugins, bundled, user };
}
