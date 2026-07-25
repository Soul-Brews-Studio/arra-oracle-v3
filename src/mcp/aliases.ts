/** Backward-compatible MCP tool alias resolution. */
const ALIAS_PREFIXES = ['arra_', 'muninn_'] as const;

/**
 * Aliases slated for removal in the NEXT release. `arra_` is deliberately
 * absent — it stays supported and silent. Removing a prefix from here is a
 * no-op; removal also requires dropping it from ALIAS_PREFIXES above.
 */
const DEPRECATED_PREFIXES = ['muninn_'] as const;

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

/**
 * Deprecation notice for `name`, or null when none is warranted.
 * Null when no rewrite happened (bare `muninn_`, `not_muninn_thing`, canonical
 * `oracle_*`) and null for non-deprecated aliases (`arra_*`, `arra_muninn_x`).
 */
export function deprecatedAliasWarning(name: string): string | null {
  const clean = name.trim();
  const resolved = resolveToolName(clean);
  if (resolved === clean) return null;
  if (!DEPRECATED_PREFIXES.some((prefix) => clean.startsWith(prefix))) return null;
  return `[MCP] tool alias "${clean}" is deprecated — use "${resolved}" (removal planned next release)`;
}

/**
 * Resolve an inbound tool name, emitting one deprecation warning per call when
 * a deprecated alias was used. `log` is injectable for tests; production passes
 * nothing so the notice reaches the operator on stderr.
 */
export function resolveInboundToolName(name: string, log: (m: string) => void = console.error): string {
  const warning = deprecatedAliasWarning(name);
  if (warning) log(warning);
  return resolveToolName(name);
}
