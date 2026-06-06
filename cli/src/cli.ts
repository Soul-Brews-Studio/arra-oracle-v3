#!/usr/bin/env bun

import { join } from "path";
import { discoverPlugins } from "./plugin/loader.ts";
import { registerPlugins, resolveCommand, listPlugins } from "./plugin/registry.ts";
import { invokePlugin } from "./plugin/invoke.ts";
import type { LoadedPlugin } from "./plugin/types.ts";
import { pluginsList } from "./commands/plugins-list.ts";
import { pluginsCommand } from "./commands/plugins.ts";
import { pluginsRemove } from "./commands/plugins-remove.ts";
import { pluginsInfo } from "./commands/plugins-info.ts";
import { sessionList } from "./commands/session-list.ts";
import { sessionShow } from "./commands/session-show.ts";
import { sessionContext } from "./commands/session-context.ts";
import { menuList } from "./commands/menu-list.ts";
import { menuAdd } from "./commands/menu-add.ts";
import { menuRemove } from "./commands/menu-remove.ts";
import {
  menuGistStatus,
  menuGistUrl,
  menuGistClear,
  menuGistReload,
} from "./commands/menu-gist.ts";
import { menuResetAll } from "./commands/menu-reset.ts";
import { configCommand, useCommand } from "./commands/config.ts";
import { doctorCommand } from "./commands/doctor.ts";
import { completionsCommand } from "./commands/completions.ts";
import { peersCommand } from "./commands/peers.ts";
import { BUILTIN_COMMANDS } from "./commands/catalog.ts";

const pkg = await Bun.file(join(import.meta.dir, "../package.json")).json();
const VERSION: string = pkg.version;

function printHelp(commands: Array<{ command: string; help?: string }>) {
  console.log(`arra-cli v${VERSION} — ARRA Oracle V3 CLI\n`);
  console.log("Usage: arra-cli <command> [args...]\n");
  console.log("Commands:");
  for (const { command, help } of BUILTIN_COMMANDS) {
    console.log(`  ${command.padEnd(16)}${help}`);
  }
  for (const { command, help } of commands) {
    console.log(`  ${command.padEnd(16)}${help ?? ""}`);
  }
  console.log("\nFlags:");
  console.log("  --at <name>       Run against a named ARRA target from config");
  console.log("  --help, -h        Show this help");
  console.log("  -h <command>      Show command help + flags");
  console.log("  --version         Show version");
}

function printCommandHelp(plugin: LoadedPlugin) {
  const cli = plugin.manifest.cli!;
  console.log(`${cli.command} — ${cli.help ?? "(no description)"}`);
  if (cli.aliases?.length) {
    console.log(`  aliases: ${cli.aliases.join(", ")}`);
  }
  if (cli.flags && Object.keys(cli.flags).length > 0) {
    console.log("\nFlags:");
    for (const [flag, desc] of Object.entries(cli.flags)) {
      console.log(`  ${flag.padEnd(20)}${desc}`);
    }
  } else {
    console.log("  (no flags)");
  }
}

async function loadAll() {
  const { plugins, bundled, user } = await discoverPlugins();
  registerPlugins(plugins);
  const total = bundled + user;
  const parts: string[] = [`${bundled} bundled`];
  if (user > 0) parts.push(`${user} user`);
  console.log(`loaded ${total} plugin${total !== 1 ? "s" : ""} (${parts.join(", ")})`);
}

async function main() {
  const args = process.argv.slice(2);
  const atIndex = args.indexOf("--at");
  if (atIndex >= 0) {
    const target = args[atIndex + 1];
    if (!target) {
      console.error("usage: arra --at <name> <command>");
      process.exit(1);
    }
    process.env.ARRA_AT = target;
    args.splice(atIndex, 2);
  }
  const cmd = args[0]?.toLowerCase();

  if (cmd === "--version" || cmd === "version") {
    console.log(`arra-cli v${VERSION}`);
    return;
  }

  if (cmd === "completions") {
    process.exit(await completionsCommand(args.slice(1)));
  }

  if (cmd === "config") {
    process.exit(await configCommand(args.slice(1)));
  }

  if (cmd === "doctor") {
    process.exit(await doctorCommand(args.slice(1)));
  }

  if (cmd === "peers") {
    process.exit(await peersCommand(args.slice(1)));
  }

  if (cmd === "use") {
    process.exit(await useCommand(args.slice(1)));
  }

  if (cmd === "session") {
    const sub = args[1]?.toLowerCase();
    const rest = args.slice(2);
    if (sub === "list" || sub === "ls") {
      process.exit(await sessionList(rest));
    }
    if (sub === "show") {
      process.exit(await sessionShow(rest));
    }
    if (sub === "context") {
      process.exit(await sessionContext(rest));
    }
    if (!sub || sub === "--help" || sub === "-h") {
      console.log("arra-cli session <subcommand>\n");
      console.log("Subcommands:");
      console.log("  list                list all sessions");
      console.log("  show <id>           show session summary");
      console.log("  context <id>        dump full session context");
      console.log("\nOutput defaults to JSON; pass --yml for YAML.");
      console.log("\nEnv:");
      console.log("  ORACLE_API          API base URL (default http://localhost:47778)");
      return;
    }
    console.error(`\x1b[31m✗\x1b[0m unknown session subcommand: ${args[1]}`);
    console.error("  try: arra-cli session list|show|context");
    process.exit(1);
  }

  if (cmd === "menu") {
    const sub = args[1]?.toLowerCase();
    const rest = args.slice(2);
    if (sub === "list" || sub === "ls") {
      process.exit(await menuList(rest));
    }
    if (sub === "add") {
      process.exit(await menuAdd(rest));
    }
    if (sub === "remove" || sub === "rm") {
      process.exit(await menuRemove(rest));
    }
    if (sub === "gist-status") {
      process.exit(await menuGistStatus(rest));
    }
    if (sub === "gist-url") {
      process.exit(await menuGistUrl(rest));
    }
    if (sub === "gist-clear") {
      process.exit(await menuGistClear(rest));
    }
    if (sub === "gist-reload") {
      process.exit(await menuGistReload(rest));
    }
    if (sub === "reset-all") {
      process.exit(await menuResetAll(rest));
    }
    if (!sub || sub === "--help" || sub === "-h") {
      console.log("arra-cli menu <subcommand>\n");
      console.log("Subcommands:");
      console.log("  list [--custom]                         list menu items (JSON array)");
      console.log("  add --path /p --label L [--group g] [--order N] [--icon i]");
      console.log("                                          add or replace a custom menu item");
      console.log("  remove <path>                           remove a custom menu item");
      console.log("  gist-status                             show current gist source");
      console.log("  gist-url <url> [--override]             set gist URL (merge|override)");
      console.log("  gist-clear                              clear gist URL");
      console.log("  gist-reload                             force refetch of gist menu");
      console.log("  reset-all [--yes]                       nuclear reset (prompts y/N)");
      console.log("\nOutput defaults to JSON; pass --yml for YAML.");
      console.log("\nEnv:");
      console.log("  ORACLE_API          API base URL (default http://localhost:47778)");
      return;
    }
    console.error(`\x1b[31m✗\x1b[0m unknown menu subcommand: ${args[1]}`);
    console.error("  try: arra-cli menu list|add|remove|gist-*|reset-all");
    process.exit(1);
  }

  if (cmd === "plugins") {
    process.exit(await pluginsCommand(args.slice(1)));
  }

  if (cmd === "plugin") {
    const sub = args[1]?.toLowerCase();
    const rest = args.slice(2);
    if (sub === "install") {
      const { runInstallCli } = await import("./commands/plugins-install.ts");
      process.exit(await runInstallCli(rest));
    }
    if (sub === "list" || sub === "ls") {
      process.exit(await pluginsList(rest));
    }
    if (sub === "remove" || sub === "rm") {
      process.exit(await pluginsRemove(rest));
    }
    if (sub === "info") {
      process.exit(await pluginsInfo(rest));
    }
    if (!sub || sub === "--help" || sub === "-h") {
      console.log("arra-cli plugin <subcommand>\n");
      console.log("Subcommands:");
      console.log("  list                    list installed plugins");
      console.log("  info <name>             show plugin details");
      console.log("  install <url-or-path>   install a plugin (see --help)");
      console.log("  remove <name>           remove an installed plugin");
      console.log("\nOutput defaults to JSON; pass --yml for YAML.");
      return;
    }
    console.error(`\x1b[31m✗\x1b[0m unknown plugin subcommand: ${args[1]}`);
    console.error("  try: arra-cli plugin list|info|install|remove");
    process.exit(1);
  }

  if (!cmd || cmd === "--help") {
    await loadAll();
    const commands = listPlugins()
      .filter(p => p.manifest.cli)
      .map(p => ({ command: p.manifest.cli!.command, help: p.manifest.cli!.help }));
    printHelp(commands);
    return;
  }

  if (cmd === "-h") {
    const subcmd = args[1]?.toLowerCase();
    await loadAll();
    if (!subcmd) {
      const commands = listPlugins()
        .filter(p => p.manifest.cli)
        .map(p => ({ command: p.manifest.cli!.command, help: p.manifest.cli!.help }));
      printHelp(commands);
      return;
    }
    const plugin = resolveCommand(subcmd);
    if (!plugin || !plugin.manifest.cli) {
      console.error(`unknown command: ${args[1]}`);
      process.exit(1);
    }
    printCommandHelp(plugin);
    return;
  }

  await loadAll();

  const plugin = resolveCommand(cmd);
  if (!plugin) {
    console.error(`\x1b[31m✗\x1b[0m unknown command: ${args[0]}`);
    console.error(`  run 'arra-cli --help' to see available commands`);
    process.exit(1);
  }

  const result = await invokePlugin(plugin, { source: "cli", args: args.slice(1) });
  if (result.ok && result.output) {
    console.log(result.output);
  } else if (!result.ok) {
    console.error(result.error ?? "plugin failed");
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
