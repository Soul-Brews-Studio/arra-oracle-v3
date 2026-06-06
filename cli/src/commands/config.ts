import { loadConfigSources, mergedTargets, resolveOracleApiBase, globalConfigPath, writeGlobalDefault } from "../lib/config.ts";

export async function configCommand(args: string[]): Promise<number> {
  const sub = args[0]?.toLowerCase();
  if (sub === "path") {
    console.log(globalConfigPath());
    return 0;
  }
  if (sub === "use") {
    const name = args[1];
    if (!name) {
      console.error("usage: arra config use <name>");
      return 1;
    }
    const path = writeGlobalDefault(name);
    console.log(`Set global ARRA target to '${name}' (${path})`);
    return 0;
  }
  if (sub && sub !== "show") {
    console.error(`unknown config subcommand: ${args[0]}`);
    console.error("try: arra config [show|path|use <name>]");
    return 1;
  }

  const resolved = resolveOracleApiBase();
  const sources = loadConfigSources();
  const targets = mergedTargets(sources);
  const data = {
    resolved,
    configPath: globalConfigPath(),
    sources: sources.map(s => ({ kind: s.kind, path: s.path, default: s.config.default })),
    targets,
  };
  console.log(JSON.stringify(data, null, 2));
  return 0;
}

export async function useCommand(args: string[]): Promise<number> {
  const name = args[0];
  if (!name) {
    console.error("usage: arra use <name>");
    return 1;
  }
  const path = writeGlobalDefault(name);
  console.log(`Set global ARRA target to '${name}' (${path})`);
  return 0;
}
