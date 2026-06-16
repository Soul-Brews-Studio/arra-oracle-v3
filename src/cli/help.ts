import pkg from "../../package.json" with { type: "json" };

export const CLI_VERSION: string = pkg.version;

export interface CliHelpEntry {
  command: string;
  help?: string;
  aliases?: string[];
  subcommands?: string[];
  flags?: string[] | Record<string, string>;
  usage?: string;
  examples?: string[];
}

export const BUILTIN_HELP: CliHelpEntry[] = [
  {
    command: "plugin",
    help: "manage installable CLI plugins",
    usage: "arra-cli plugin <subcommand>",
    subcommands: ["list", "info <name>", "install <url-or-path>", "remove <name>"],
    flags: ["--json", "--yml", "--help", "-h"],
    examples: ["arra-cli plugin list", "arra-cli plugin info search", "arra-cli plugin install ./my-plugin"],
  },
  {
    command: "plugins",
    help: "manage MCP tool plugin manifest",
    usage: "arra-cli plugins <subcommand>",
    subcommands: ["list", "enable <name>", "disable <name>"],
    flags: ["--json", "--help", "-h"],
    examples: ["arra-cli plugins list --json", "arra-cli plugins disable trace", "arra-cli plugins enable trace"],
  },
  {
    command: "session",
    help: "inspect sessions",
    usage: "arra-cli session <subcommand>",
    subcommands: ["list", "show <id>", "context <id>"],
    flags: ["--json", "--yml", "--help", "-h"],
    examples: ["arra-cli session list", "arra-cli session show abc123", "arra-cli session context abc123 --yml"],
  },
  {
    command: "menu",
    help: "inspect and customize studio menu",
    usage: "arra-cli menu <subcommand>",
    subcommands: ["list [--custom]", "add --path /p --label L [--group g] [--order N] [--icon i]", "remove <path>", "gist-status", "gist-url <url> [--override]", "gist-clear", "gist-reload", "reset-all [--yes]"],
    flags: ["--json", "--yml", "--custom", "--override", "--yes", "--help", "-h"],
    examples: ["arra-cli menu list --json", "arra-cli menu add --path /lab --label Lab", "arra-cli menu gist-url https://gist.github.com/user/id"],
  },
  {
    command: "config",
    help: "show resolved API target and config sources",
    usage: "arra-cli config [show|path|use <name>]",
    subcommands: ["show", "path", "use <name>"],
    flags: ["--json", "--help", "-h"],
    examples: ["arra-cli config show", "arra-cli config path", "arra-cli config use cafe"],
  },
  {
    command: "doctor",
    help: "run operator diagnostics against the resolved target",
    usage: "arra-cli doctor [--json]",
    flags: ["--json", "--help", "-h"],
    examples: ["arra-cli doctor", "arra-cli doctor --json", "arra-cli --at cafe doctor"],
  },
  {
    command: "use",
    help: "set the global default API target",
    usage: "arra-cli use <name>",
    examples: ["arra-cli use cafe"],
  },
  {
    command: "completions",
    help: "print shell completion scripts",
    usage: "arra-cli completions <bash|zsh|fish>",
    subcommands: ["bash", "zsh", "fish"],
    flags: ["--help", "-h"],
    examples: ["arra-cli completions zsh >> ~/.zshrc", "arra-cli completions fish"],
  },
  {
    command: "peers",
    help: "probe configured federation peers",
    usage: "arra-cli peers [--token <token>] [--json]",
    flags: ["--token <token>", "--json", "--help", "-h"],
    examples: ["arra-cli peers", "arra-cli peers --token $ORACLE_TOKEN --json"],
  },
  {
    command: "huginn",
    help: "run Huginn capture utilities",
    usage: "arra-cli huginn <subcommand>",
    subcommands: ["sweep"],
    flags: ["--sessions-dir <path[:path...]>", "--repo-root <path>", "--lookback-hours <n>", "--max-files <n>", "--json", "--help", "-h"],
    examples: ["arra-cli huginn sweep --lookback-hours 24", "arra-cli huginn sweep --sessions-dir ~/.claude/projects --json"],
  },
  {
    command: "vector-config",
    help: "inspect and manage vector embedding collection config",
    usage: "arra-cli vector-config <subcommand>",
    subcommands: ["list", "get <collection>", "stats [<collection>]", "set <collection> <field> <value>", "reload", "test <collection>"],
    flags: ["--json", "--yml", "--help", "-h", "--model <name>", "--provider <name>", "--adapter <name>"],
    examples: ["arra-cli vector-config list", "arra-cli vector-config get bge-m3", "arra-cli vector-config stats bge-m3", "arra-cli vector-config set bge-m3 enabled false", "arra-cli vector-config reload"],
  },
  {
    command: "migrate",
    help: "run Drizzle migration generate and push",
    usage: "arra-cli migrate",
    flags: ["--help", "-h"],
    examples: ["arra-cli migrate"],
  },
  {
    command: "seed",
    help: "populate development DB sample data",
    usage: "arra-cli seed",
    flags: ["--help", "-h"],
    examples: ["arra-cli seed"],
  },
  {
    command: "backup",
    help: "dump SQLite DB to timestamped SQL",
    usage: "arra-cli backup [--out-dir <dir>]",
    flags: ["--out-dir <dir>", "--help", "-h"],
    examples: ["arra-cli backup", "arra-cli backup --out-dir ./backups"],
  },
  {
    command: "changelog",
    help: "generate CHANGELOG.md from git history",
    usage: "arra-cli changelog [--since <tag>] [--out CHANGELOG.md] [--stdout]",
    flags: ["--since <tag>", "--out <file>", "--stdout", "--help", "-h"],
    examples: ["arra-cli changelog", "arra-cli changelog --since v1.2.3 --stdout"],
  },
  {
    command: "release",
    help: "bump CalVer, write changelog, and create a tag",
    usage: "arra-cli release [--beta|--stable] [--changelog CHANGELOG.md] [--dry-run]",
    flags: ["--beta", "--stable", "--changelog <file>", "--dry-run", "--check", "--help", "-h"],
    examples: ["arra-cli release", "arra-cli release --beta", "arra-cli release --dry-run"],
  },
];

const SUBCOMMAND_HELP: CliHelpEntry[] = [
  { command: "config show", help: "show resolved API target and config sources", usage: "arra-cli config show", examples: ["arra-cli config show"] },
  { command: "config path", help: "print the global config path", usage: "arra-cli config path", examples: ["arra-cli config path"] },
  { command: "config use", help: "set the global default API target", usage: "arra-cli config use <name>", examples: ["arra-cli config use cafe"] },
  { command: "session list", help: "list all sessions", usage: "arra-cli session list [--json|--yml]", examples: ["arra-cli session list", "arra-cli session list --yml"] },
  { command: "session show", help: "show a session summary", usage: "arra-cli session show <id> [--json|--yml]", examples: ["arra-cli session show abc123"] },
  { command: "session context", help: "dump full session context", usage: "arra-cli session context <id> [--json|--yml]", examples: ["arra-cli session context abc123 --yml"] },
  { command: "menu list", help: "list menu items", usage: "arra-cli menu list [--custom] [--json|--yml]", examples: ["arra-cli menu list", "arra-cli menu list --custom --json"] },
  { command: "menu add", help: "add or replace a custom menu item", usage: "arra-cli menu add --path /p --label L [--group g] [--order N] [--icon i]", examples: ["arra-cli menu add --path /lab --label Lab --group tools"] },
  { command: "menu remove", help: "remove a custom menu item", usage: "arra-cli menu remove <path>", examples: ["arra-cli menu remove /lab"] },
  { command: "menu gist-status", help: "show current gist menu source", usage: "arra-cli menu gist-status", examples: ["arra-cli menu gist-status"] },
  { command: "menu gist-url", help: "set gist menu URL", usage: "arra-cli menu gist-url <url> [--override]", examples: ["arra-cli menu gist-url https://gist.github.com/user/id"] },
  { command: "menu gist-clear", help: "clear gist menu URL", usage: "arra-cli menu gist-clear", examples: ["arra-cli menu gist-clear"] },
  { command: "menu gist-reload", help: "force refetch of gist menu", usage: "arra-cli menu gist-reload", examples: ["arra-cli menu gist-reload"] },
  { command: "menu reset-all", help: "reset all custom menu state", usage: "arra-cli menu reset-all [--yes]", examples: ["arra-cli menu reset-all --yes"] },
  { command: "vector-config list", help: "list available vector collections", usage: "arra-cli vector-config list", examples: ["arra-cli vector-config list"] },
  { command: "vector-config get", help: "show a collection config", usage: "arra-cli vector-config get <collection>", examples: ["arra-cli vector-config get bge-m3"] },
  { command: "vector-config stats", help: "show vector document counts", usage: "arra-cli vector-config stats [<collection>]", examples: ["arra-cli vector-config stats", "arra-cli vector-config stats bge-m3"] },
  { command: "vector-config set", help: "set collection model/provider/adapter/enabled", usage: "arra-cli vector-config set <collection> <field> <value>", examples: ["arra-cli vector-config set bge-m3 enabled false", "arra-cli vector-config set bge-m3 --adapter qdrant --provider remote"] },
  { command: "vector-config reload", help: "clear cached vector collection stores", usage: "arra-cli vector-config reload", examples: ["arra-cli vector-config reload"] },
  { command: "vector-config test", help: "probe one collection adapter", usage: "arra-cli vector-config test <collection>", examples: ["arra-cli vector-config test bge-m3"] },
  { command: "plugins list", help: "list MCP tool plugins", usage: "arra-cli plugins list [--json]", examples: ["arra-cli plugins list --json"] },
  { command: "plugins enable", help: "enable an MCP tool plugin", usage: "arra-cli plugins enable <name> [--json]", examples: ["arra-cli plugins enable trace"] },
  { command: "plugins disable", help: "disable an MCP tool plugin", usage: "arra-cli plugins disable <name> [--json]", examples: ["arra-cli plugins disable trace"] },
  { command: "plugin list", help: "list installed CLI plugins", usage: "arra-cli plugin list [--json|--yml]", examples: ["arra-cli plugin list"] },
  { command: "plugin info", help: "show installed plugin details", usage: "arra-cli plugin info <name> [--json|--yml]", examples: ["arra-cli plugin info search"] },
  { command: "plugin install", help: "install a CLI plugin", usage: "arra-cli plugin install <url-or-path> [--force] [--dry-run]", examples: ["arra-cli plugin install ./my-plugin --dry-run", "arra-cli plugin install github.com/org/plugin --force"] },
  { command: "plugin remove", help: "remove an installed CLI plugin", usage: "arra-cli plugin remove <name> [--yes]", examples: ["arra-cli plugin remove search --yes"] },
  { command: "huginn sweep", help: "back-fill missed Huginn session captures and learnings", usage: "arra-cli huginn sweep [--sessions-dir PATH[:PATH...]] [--repo-root PATH] [--lookback-hours N] [--max-files N] [--json]", examples: ["arra-cli huginn sweep --lookback-hours 24"] },
];

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
