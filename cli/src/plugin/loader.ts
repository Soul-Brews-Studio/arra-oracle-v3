import { join, resolve } from "path";
import { homedir } from "os";
import { existsSync, readdirSync } from "fs";
import { parseManifest, validateManifest } from "./manifest.ts";
import type { LoadedPlugin } from "./types.ts";
import {
  discoverUnifiedPluginManifests,
  type LoadedUnifiedPlugin,
} from "../../../src/plugins/unified-loader.ts";

const USER_PLUGIN_DIR = join(homedir(), ".neo-arra", "plugins");
const BUNDLED_PLUGIN_DIR = join(import.meta.dir, "..", "plugins");

export interface DiscoverResult {
  plugins: LoadedPlugin[];
  bundled: number;
  user: number;
}

async function loadPluginDir(dir: string): Promise<LoadedPlugin | null> {
  const manifestPath = join(dir, "plugin.json");
  if (!existsSync(manifestPath)) return null;
  try {
    const raw = await Bun.file(manifestPath).json();
    const manifest = parseManifest(raw);
    validateManifest(manifest);
    const entryPath = resolve(dir, manifest.entry);
    return { manifest, dir, entryPath };
  } catch {
    return null;
  }
}

function fromUnifiedPlugin(plugin: LoadedUnifiedPlugin): LoadedPlugin {
  return {
    manifest: plugin.manifest,
    dir: plugin.dir,
    entryPath: plugin.entryPath,
  };
}

export async function discoverPlugins(): Promise<DiscoverResult> {
  const plugins: LoadedPlugin[] = [];
  const seen = new Set<string>();
  let bundled = 0;
  let user = 0;

  for (const plugin of await discoverUnifiedPluginManifests()) {
    if (seen.has(plugin.manifest.name)) continue;
    seen.add(plugin.manifest.name);
    plugins.push(fromUnifiedPlugin(plugin));
    user++;
  }

  // user plugins scanned first so they override bundled plugins with the same name
  for (const [isUser, baseDir] of [[true, USER_PLUGIN_DIR], [false, BUNDLED_PLUGIN_DIR]] as [boolean, string][]) {
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
