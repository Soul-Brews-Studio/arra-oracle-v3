/** Backward-compatible MCP tool alias resolution. */
const ALIAS_PREFIXES = ['arra_', 'muninn_'] as const;

export function resolveToolName(name: string): string {
  const clean = name.trim();
  for (const prefix of ALIAS_PREFIXES) {
    if (!clean.startsWith(prefix)) continue;
    const suffix = clean.slice(prefix.length).trim();
    if (!suffix) return clean;
    return suffix.startsWith('oracle_') ? suffix : `oracle_${suffix}`;
  }
  return clean;
}
