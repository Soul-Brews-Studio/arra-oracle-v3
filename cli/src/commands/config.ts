import {
  addGlobalTarget,
  globalConfigPathForWrite,
  loadGlobalConfig,
  loadProjectConfig,
  normalizeApiBase,
  resolveOracleApiBase,
  useGlobalTarget,
} from "../lib/config.ts";

function usage(): void {
  console.log(`arra-cli config <subcommand>

Subcommands:
  show                 show resolved API target and configured targets
  use <name>           set global default target
  add <name> <url>     add or update a global target
  path                 print global config file path

Aliases: \`arra-cli config\` is \`arra-cli config show\`.`);
}

function sourceLabel(source: string): string {
  return source === "ORACLE_API" ? "env" : source;
}

function knownTargets(): Record<string, string> {
  return {
    ...(loadGlobalConfig()?.config.targets ?? {}),
    ...(loadProjectConfig()?.config.targets ?? {}),
  };
}

function show(): number {
  const resolved = resolveOracleApiBase();
  const projectConfig = loadProjectConfig()?.config;
  const globalConfig = loadGlobalConfig()?.config;
  const targets = knownTargets();
  const active = resolved.target ?? Object.entries(targets)
    .find(([, url]) => normalizeApiBase(url) === resolved.url)?.[0];
  console.log(`Resolved: ${resolved.url}`);
  console.log(`Source: ${sourceLabel(resolved.source)}`);
  if (resolved.target) console.log(`Target: ${resolved.target}`);
  if (resolved.path) console.log(`Config: ${resolved.path}`);
  console.log("Targets:");
  const names = Object.keys(targets).sort();
  if (!names.length) console.log("  (none configured)");
  for (const name of names) console.log(`${name === active ? "*" : " "} ${name.padEnd(12)} ${targets[name]}`);
  const disabled = [...new Set([...(globalConfig?.disabledPlugins ?? []), ...(projectConfig?.disabledPlugins ?? [])])].sort();
  const enabled = [...new Set([...(globalConfig?.enabledPlugins ?? []), ...(projectConfig?.enabledPlugins ?? [])])].sort();
  console.log("Server plugins:");
  console.log(`  disabled: ${disabled.join(", ") || "(none)"}`);
  console.log(`  enabled:  ${enabled.join(", ") || "(none)"}`);
  return 0;
}

function required(value: string | undefined, label: string): string {
  if (!value) throw new Error(`missing ${label}`);
  return value;
}

export async function configCommand(args: string[]): Promise<number> {
  const sub = args[0]?.toLowerCase();
  try {
    if (!sub || sub === "show") return show();
    if (sub === "path") return console.log(globalConfigPathForWrite()), 0;
    if (sub === "add") {
      const name = required(args[1], "target name");
      const url = required(args[2], "target URL");
      const loaded = addGlobalTarget(name, url);
      console.log(`saved ${name} -> ${normalizeApiBase(url)}\nConfig: ${loaded.path}`);
      return 0;
    }
    if (sub === "use") {
      const name = required(args[1], "target name");
      const loaded = useGlobalTarget(name);
      console.log(`default target: ${name}\nConfig: ${loaded.path}`);
      return 0;
    }
    if (sub === "--help" || sub === "-h" || sub === "help") return usage(), 0;
    console.error(`\x1b[31m✗\x1b[0m unknown config subcommand: ${args[0]}`);
    usage();
    return 1;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

export async function useCommand(args: string[]): Promise<number> {
  return configCommand(["use", ...args]);
}
