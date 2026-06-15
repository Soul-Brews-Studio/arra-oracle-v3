import type { LoadedPlugin, ResolvedCliCommand } from "./types.ts";

const registry: LoadedPlugin[] = [];

export function registerPlugins(plugins: LoadedPlugin[]): void {
  registry.length = 0;
  const sorted = [...plugins].sort((a, b) => {
    const wa = a.manifest.weight ?? 50;
    const wb = b.manifest.weight ?? 50;
    return wa - wb;
  });
  registry.push(...sorted);
}

export function pluginCliCommands(plugin: LoadedPlugin): ResolvedCliCommand[] {
  const commands: ResolvedCliCommand[] = [];
  const legacy = plugin.manifest.cli;
  if (legacy) {
    commands.push({
      plugin,
      command: legacy.command,
      help: legacy.help,
      aliases: legacy.aliases,
      flags: legacy.flags,
    });
  }
  for (const subcommand of plugin.manifest.cliSubcommands ?? []) {
    commands.push({
      plugin,
      command: subcommand.command,
      help: subcommand.help,
      handler: subcommand.handler,
    });
  }
  return commands;
}

export function listCommands(): ResolvedCliCommand[] {
  return registry.flatMap(pluginCliCommands);
}

export function resolveCommand(command: string): ResolvedCliCommand | null {
  const cmd = command.toLowerCase();
  for (const resolved of listCommands()) {
    if (resolved.command.toLowerCase() === cmd) return resolved;
    for (const alias of resolved.aliases ?? []) {
      if (alias.toLowerCase() === cmd) return resolved;
    }
  }
  return null;
}

export function listPlugins(): LoadedPlugin[] {
  return [...registry];
}
