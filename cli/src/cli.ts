#!/usr/bin/env bun

import { discoverPlugins } from "./plugin/loader.ts";
import { registerPlugins, resolveCommand, listCommands } from "./plugin/registry.ts";
import { invokePluginCommand } from "./plugin/invoke.ts";
import { pluginsList } from "./commands/plugins-list.ts";
import { pluginsCommand } from "./commands/plugins.ts";
import { pluginsRemove } from "./commands/plugins-remove.ts";
import { pluginsInfo } from "./commands/plugins-info.ts";
import { sessionList } from "./commands/session-list.ts";
import { sessionShow } from "./commands/session-show.ts";
import { sessionContext } from "./commands/session-context.ts";
import { menuCommand } from "./commands/menu.ts";
import { configCommand, useCommand } from "./commands/config.ts";
import { doctorCommand } from "./commands/doctor.ts";
import { completionsCommand } from "./commands/completions.ts";
import { peersCommand } from "./commands/peers.ts";
import { huginnCommand } from "./commands/huginn.ts";
import { vectorConfigCommand } from "./commands/vector-config.ts";
import { CLI_VERSION, builtinHelpFor, hasHelpFlag, renderCommandHelp, renderRootHelp } from "../../src/cli/help.ts";

async function loadAll() {
  const { plugins, bundled, user } = await discoverPlugins();
  registerPlugins(plugins);
  const total = bundled + user;
  const parts: string[] = [`${bundled} bundled`];
  if (user > 0) parts.push(`${user} user`);
  console.log(`loaded ${total} plugin${total !== 1 ? "s" : ""} (${parts.join(", ")})`);
}

function printBuiltinHelp(command: string | undefined): boolean {
  const help = builtinHelpFor(command);
  if (!help) return false;
  console.log(renderCommandHelp(help));
  return true;
}

function printScopedBuiltinHelp(command: string, args: string[]): boolean {
  const sub = args[0]?.toLowerCase();
  if (sub && sub !== "--help" && sub !== "-h" && printBuiltinHelp(`${command} ${sub}`)) return true;
  return printBuiltinHelp(command);
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

  if (cmd === "--version" || cmd === "-v" || cmd === "version") {
    console.log(`arra-cli v${CLI_VERSION}`);
    return;
  }

  if (!cmd || (cmd === "--help" || cmd === "-h") && !args[1]) {
    await loadAll();
    const commands = listCommands().map(c => ({ command: c.command, help: c.help }));
    console.log(renderRootHelp(commands));
    return;
  }

  if (cmd === "-h") {
    const subcmd = args[1]?.toLowerCase();
    if (!subcmd) {
      await loadAll();
      const commands = listCommands().map(c => ({ command: c.command, help: c.help }));
      console.log(renderRootHelp(commands));
      return;
    }
    if (printBuiltinHelp(subcmd)) return;
    await loadAll();
    const command = resolveCommand(subcmd);
    if (!command) {
      console.error(`unknown command: ${args[1]}`);
      process.exit(1);
    }
    console.log(renderCommandHelp(command));
    return;
  }

  if (cmd === "completions") {
    if (hasHelpFlag(args.slice(1))) return printScopedBuiltinHelp(cmd, args.slice(1));
    process.exit(await completionsCommand(args.slice(1)));
  }

  if (cmd === "config") {
    if (hasHelpFlag(args.slice(1))) return printScopedBuiltinHelp(cmd, args.slice(1));
    process.exit(await configCommand(args.slice(1)));
  }

  if (cmd === "doctor") {
    if (hasHelpFlag(args.slice(1))) return printBuiltinHelp(cmd);
    process.exit(await doctorCommand(args.slice(1)));
  }

  if (cmd === "peers") {
    if (hasHelpFlag(args.slice(1))) return printBuiltinHelp(cmd);
    process.exit(await peersCommand(args.slice(1)));
  }

  if (cmd === "huginn") {
    if (hasHelpFlag(args.slice(1))) return printScopedBuiltinHelp(cmd, args.slice(1));
    process.exit(await huginnCommand(args.slice(1)));
  }

  if (cmd === "vector-config") {
    if (hasHelpFlag(args.slice(1))) return printScopedBuiltinHelp(cmd, args.slice(1));
    process.exit(await vectorConfigCommand(args.slice(1)));
  }

  if (cmd === "changelog") {
    if (hasHelpFlag(args.slice(1))) return printBuiltinHelp(cmd);
    const { changelogCommand } = await import("../../src/cli/commands/changelog.ts");
    process.exit(await changelogCommand(args.slice(1)));
  }

  if (cmd === "release") {
    if (hasHelpFlag(args.slice(1))) return printBuiltinHelp(cmd);
    const { releaseCommand } = await import("../../src/cli/commands/release.ts");
    process.exit(await releaseCommand(args.slice(1)));
  }

  if (cmd === "export") {
    const { exportCommand } = await import("../../src/cli/commands/export.ts");
    process.exit(await exportCommand(args.slice(1)));
  }

  if (cmd === "import") {
    const { importCommand } = await import("../../src/cli/commands/import.ts");
    process.exit(await importCommand(args.slice(1)));
  }

  if (cmd === "migrate") {
    if (hasHelpFlag(args.slice(1))) return printBuiltinHelp(cmd);
    const { migrateCommand } = await import("../../src/cli/commands/migrate.ts");
    process.exit(await migrateCommand(args.slice(1)));
  }

  if (cmd === "seed") {
    if (hasHelpFlag(args.slice(1))) return printBuiltinHelp(cmd);
    const { seedCommand } = await import("../../src/cli/commands/seed.ts");
    process.exit(await seedCommand(args.slice(1)));
  }

  if (cmd === "backup") {
    if (hasHelpFlag(args.slice(1))) return printBuiltinHelp(cmd);
    const { backupCommand } = await import("../../src/cli/commands/backup.ts");
    process.exit(await backupCommand(args.slice(1)));
  }

  if (cmd === "use") {
    if (hasHelpFlag(args.slice(1))) return printBuiltinHelp(cmd);
    process.exit(await useCommand(args.slice(1)));
  }

  if (cmd === "session") {
    const sub = args[1]?.toLowerCase();
    const rest = args.slice(2);
    if (hasHelpFlag(rest)) return printScopedBuiltinHelp(cmd, args.slice(1));
    if (sub === "list" || sub === "ls") {
      process.exit(await sessionList(rest));
    }
    if (sub === "show") {
      process.exit(await sessionShow(rest));
    }
    if (sub === "context") {
      process.exit(await sessionContext(rest));
    }
    if (!sub || sub === "--help" || sub === "-h") return printBuiltinHelp(cmd);
    console.error(`\x1b[31m✗\x1b[0m unknown session subcommand: ${args[1]}`);
    console.error("  try: arra-cli session list|show|context");
    process.exit(1);
  }

  if (cmd === "menu") {
    if (!args[1] || hasHelpFlag(args.slice(1))) return printScopedBuiltinHelp(cmd, args.slice(1));
    process.exit(await menuCommand(args.slice(1)));
  }

  if (cmd === "plugins") {
    if (hasHelpFlag(args.slice(1))) return printScopedBuiltinHelp(cmd, args.slice(1));
    process.exit(await pluginsCommand(args.slice(1)));
  }

  if (cmd === "plugin") {
    const sub = args[1]?.toLowerCase();
    const rest = args.slice(2);
    if (!sub || sub === "--help" || sub === "-h") return printBuiltinHelp(cmd);
    if (hasHelpFlag(rest)) return printScopedBuiltinHelp(cmd, args.slice(1));
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
    console.error(`\x1b[31m✗\x1b[0m unknown plugin subcommand: ${args[1]}`);
    console.error("  try: arra-cli plugin list|info|install|remove");
    process.exit(1);
  }

  await loadAll();

  const command = resolveCommand(cmd);
  if (!command) {
    console.error(`\x1b[31m✗\x1b[0m unknown command: ${args[0]}`);
    console.error(`  run 'arra-cli --help' to see available commands`);
    process.exit(1);
  }
  if (hasHelpFlag(args.slice(1))) {
    console.log(renderCommandHelp(command));
    return;
  }

  const result = await invokePluginCommand(command, {
    source: "cli",
    args: args.slice(1),
    writer: (...parts: unknown[]) => console.log(...parts),
  });
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
