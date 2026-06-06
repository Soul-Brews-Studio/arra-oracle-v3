export interface CommandSpec {
  command: string;
  help: string;
  subcommands?: string[];
  flags?: string[];
}

export const COMMON_FLAGS = ["--at", "--json", "--help", "-h", "--version"];

export const BUILTIN_COMMANDS: CommandSpec[] = [
  { command: "plugin", help: "manage installable CLI plugins", subcommands: ["list", "info", "install", "remove"], flags: ["--json", "--yml", "--help", "-h"] },
  { command: "plugins", help: "manage MCP tool plugin manifest", subcommands: ["list", "enable", "disable"], flags: ["--json", "--help", "-h"] },
  { command: "session", help: "inspect sessions", subcommands: ["list", "show", "context"], flags: ["--json", "--yml", "--help", "-h"] },
  { command: "menu", help: "inspect and customize studio menu", subcommands: ["list", "add", "remove", "gist-status", "gist-url", "gist-clear", "gist-reload", "reset-all"], flags: ["--json", "--yml", "--help", "-h"] },
  { command: "config", help: "show resolved API target and config sources", subcommands: ["show", "path", "use"], flags: ["--json", "--help", "-h"] },
  { command: "doctor", help: "run operator diagnostics against the resolved target", flags: ["--json", "--help", "-h"] },
  { command: "use", help: "set the global default API target" },
  { command: "completions", help: "print shell completion scripts", subcommands: ["bash", "zsh", "fish"], flags: ["--help", "-h"] },
  { command: "peers", help: "probe configured federation peers", flags: ["--token", "--json", "--help", "-h"] },
  { command: "huginn", help: "run Huginn capture utilities", subcommands: ["sweep"], flags: ["--sessions-dir", "--repo-root", "--lookback-hours", "--max-files", "--json", "--help", "-h"] },
];
