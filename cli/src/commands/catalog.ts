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
  { command: "mcp", help: "run MCP stdio server", flags: ["--read-only", "--help", "-h"] },
  { command: "search", help: "search principles, patterns, learnings and retros", flags: ["--type", "--limit", "--offset", "--project", "--json", "--help", "-h"] },
  { command: "ask", help: "ask the knowledge base about a question", flags: ["--limit", "--type", "--model", "--project", "--as-of", "--no-llm", "--json", "--help", "-h"] },
  { command: "install", help: "install a plugin from URL or path", flags: ["--force", "--dry-run", "--artifact", "--manifest", "--no-backup", "--backup-dir", "--yml", "--help", "-h"] },
  { command: "serve", help: "start/stop/status the HTTP server", subcommands: ["start", "status", "stop"], flags: ["--foreground", "--background", "--json", "--help", "-h", "-f", "-b"] },
  { command: "use", help: "set the global default API target" },
  { command: "completions", help: "print shell completion scripts", subcommands: ["bash", "zsh", "fish"], flags: ["--help", "-h"] },
  { command: "huginn", help: "run Huginn capture utilities", subcommands: ["sweep"], flags: ["--sessions-dir", "--repo-root", "--lookback-hours", "--max-files", "--json", "--help", "-h"] },
  { command: "vector-config", help: "inspect and manage vector embedding collection config", subcommands: ["list", "get", "stats", "set", "switch", "reload", "test"], flags: ["--json", "--yml", "--help", "-h", "--model", "--provider", "--adapter", "--enabled"] },
  { command: "migrate", help: "run Drizzle migration generate and push", flags: ["--help", "-h"] },
  { command: "seed", help: "populate development DB sample data", flags: ["--help", "-h"] },
  { command: "backup", help: "dump SQLite DB to timestamped SQL", flags: ["--out-dir", "--help", "-h"] },
  { command: "changelog", help: "generate CHANGELOG.md from git history", flags: ["--since", "--out", "--stdout", "--help", "-h"] },
  { command: "release", help: "bump CalVer, write changelog, and create a tag", flags: ["--beta", "--stable", "--changelog", "--dry-run", "--help", "-h"] },
  { command: "export", help: "export a collection through Oracle v2", flags: ["--url", "--collection", "--format", "--output", "--help", "-h"] },
  { command: "import", help: "import vault data from JSON", flags: ["--format", "--in", "--help", "-h"] },
];
