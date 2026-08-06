import pkg from "../../package.json" with { type: "json" };
import { BUILTIN_HELP, SUBCOMMAND_HELP, type CliHelpEntry } from "./help-entries.ts";

export const CLI_VERSION: string = pkg.version;

export { BUILTIN_HELP, type CliHelpEntry } from "./help-entries.ts";

export function builtinHelpFor(command: string | undefined): CliHelpEntry | undefined {
  if (!command) return undefined;
  const needle = command.toLowerCase();
  return [...BUILTIN_HELP, ...SUBCOMMAND_HELP].find(entry => entry.command === needle);
}

export function hasHelpFlag(args: string[]): boolean {
  return args.includes("--help") || args.includes("-h");
}

function flagEntries(flags: CliHelpEntry["flags"]): Array<[string, string]> {
  if (!flags) return [];
  if (Array.isArray(flags)) return flags.map(flag => [flag, ""]);
  return Object.entries(flags);
}

function usageFrom(entry: CliHelpEntry): string {
  if (entry.usage) return entry.usage;
  const help = entry.help ?? "";
  if (help.startsWith("arra-cli ")) return help.split(" — ")[0];
  if (help.startsWith("arra ")) return help.split(" — ")[0].replace(/^arra\b/, "arra-cli");
  return `arra-cli ${entry.command} [args...]`;
}

function examplesFrom(entry: CliHelpEntry): string[] {
  if (entry.examples?.length) return entry.examples;
  return [usageFrom(entry).replace(/\s+\[args\.\.\.\]$/, "")];
}

export function renderRootHelp(extraCommands: CliHelpEntry[] = []): string {
  const lines = [
    `arra-cli v${CLI_VERSION} — ARRA Oracle V3 CLI`,
    "",
    "Usage: arra-cli <command> [args...]",
    "",
    "Commands:",
  ];
  for (const entry of [...BUILTIN_HELP, ...extraCommands]) {
    lines.push(`  ${entry.command.padEnd(16)}${entry.help ?? ""}`);
  }
  lines.push(
    "",
    "Global flags:",
    "  --at <name>       Run against a named ARRA target from config",
    "  --help, -h        Show help",
    "  -h <command>      Show command help + flags",
    "  --version         Show version",
    "",
    "Examples:",
    "  arra-cli --version",
    "  arra-cli doctor --json",
    "  arra-cli menu list",
    "  arra-cli -h search",
  );
  return lines.join("\n");
}

export function renderCommandHelp(entry: CliHelpEntry): string {
  const lines = [
    `${entry.command} — ${entry.help ?? "(no description)"}`,
    "",
    `Usage: ${usageFrom(entry)}`,
  ];
  if (entry.aliases?.length) lines.push("", `Aliases: ${entry.aliases.join(", ")}`);
  if (entry.subcommands?.length) {
    lines.push("", "Subcommands:");
    for (const sub of entry.subcommands) lines.push(`  ${sub}`);
  }
  const flags = flagEntries(entry.flags);
  lines.push("", "Flags:");
  if (flags.length) {
    for (const [flag, desc] of flags) lines.push(`  ${flag.padEnd(24)}${desc}`);
  } else {
    lines.push("  (no flags)");
  }
  lines.push("", "Examples:");
  for (const example of examplesFrom(entry)) lines.push(`  ${example}`);
  return lines.join("\n");
}
