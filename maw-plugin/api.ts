type ApiArgs = Record<string, unknown>;

const COMMAND_KEYS = new Set(['command', 'subcommand', 'action', 'cmd', 'tool']);
const ARRAY_KEYS = new Set(['args', 'argv']);

function commandFrom(input: ApiArgs): string | undefined {
  for (const key of COMMAND_KEYS) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
}

function appendFlag(argv: string[], key: string, value: unknown): void {
  if (value === undefined || value === null || value === '') return;
  const flag = `--${key.replace(/_/g, '-')}`;
  if (Array.isArray(value)) {
    if (value.length) argv.push(flag, value.map(String).join(','));
    return;
  }
  argv.push(flag, String(value));
}

function appendPositionals(argv: string[], value: unknown): void {
  if (Array.isArray(value)) argv.push(...value.map(String));
  else if (typeof value === 'string' && value.trim()) argv.push(...value.trim().split(/\s+/));
}

export function apiArgsToCliArgs(args: string[] | ApiArgs | undefined): string[] {
  if (Array.isArray(args)) return args;
  if (!args || typeof args !== 'object') return [];
  const command = commandFrom(args);
  const argv = command ? [command] : [];
  appendPositionals(argv, args.argv ?? args.args);

  const flags = args.flags && typeof args.flags === 'object' && !Array.isArray(args.flags)
    ? args.flags as ApiArgs
    : undefined;
  for (const [key, value] of Object.entries(flags ?? args)) {
    if (COMMAND_KEYS.has(key) || ARRAY_KEYS.has(key) || key === 'flags') continue;
    appendFlag(argv, key, value);
  }
  return argv;
}
