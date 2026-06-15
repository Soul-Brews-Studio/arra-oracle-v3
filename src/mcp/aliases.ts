/** Backward-compatible MCP tool alias resolution. */
const ALIAS_PREFIXES = ['arra_', 'muninn_'] as const;

export function resolveToolName(name: string): string {
  for (const prefix of ALIAS_PREFIXES) {
    if (name.startsWith(prefix)) return 'oracle_' + name.slice(prefix.length);
  }
  return name;
}
