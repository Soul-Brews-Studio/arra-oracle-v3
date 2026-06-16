/** Backward-compatible MCP tool alias resolution. */
const ALIAS_PREFIXES = ['arra_', 'muninn_'] as const;

export function resolveToolName(name: string): string {
  const clean = name.trim();
  for (const prefix of ALIAS_PREFIXES) {
    if (clean.startsWith(prefix)) return 'oracle_' + clean.slice(prefix.length);
  }
  return clean;
}
