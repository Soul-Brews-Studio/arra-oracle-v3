import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { LoadedPlugin, PluginManifest, ResolvedCliCommand } from "../../../cli/src/plugin/types.ts";

export function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    name: "demo",
    version: "1.0.0",
    entry: "./index.ts",
    sdk: "^0.0.1",
    ...overrides,
  };
}

export function loaded(overrides: Partial<PluginManifest> = {}): LoadedPlugin {
  const m = manifest(overrides);
  return { manifest: m, dir: `/tmp/${m.name}`, entryPath: `/tmp/${m.name}/index.ts` };
}

export function command(plugin: LoadedPlugin, overrides: Partial<ResolvedCliCommand> = {}): ResolvedCliCommand {
  return { plugin, command: "demo", ...overrides };
}

export function writePlugin(dir: string, data: Partial<PluginManifest>, entry = "export default () => ({ ok: true });\n") {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "plugin.json"), JSON.stringify(manifest(data), null, 2));
  writeFileSync(join(dir, "index.ts"), entry);
}

export function writeModule(path: string, source: string): string {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, source);
  return path;
}
