/** Backward-compatible MCP tool alias resolution. */
const ALIAS_PREFIXES = ['arra_'] as const;

/**
 * Aliases slated for removal in the NEXT release. `arra_` is deliberately
 * absent — it stays supported and silent. Removing a prefix from here is a
 * no-op; removal also requires dropping it from ALIAS_PREFIXES above.
 *
 * Empty today: `muninn_` finished the cycle — warned in #2839, shipped in
 * v26.7.26-alpha.227 (verified: the tag contains that commit), removed here.
 * The machinery stays for whatever is deprecated next.
 */
const DEPRECATED_PREFIXES = [] as const satisfies readonly string[];

/**
 * Prefixes that USED to resolve and no longer do.
 *
 * `resolveToolName` fails **silently** when a prefix stops matching: it returns the name
 * unchanged and the call dies later as a generic tool-not-found, with nothing connecting the
 * failure to the rename. That silence is why #2824 required a deprecation release before
 * removal, and it would still bite any client that missed the warning.
 *
 * So a retired prefix keeps a voice. It no longer resolves — but it says why.
 */
const RETIRED_PREFIXES = ['muninn_'] as const;

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
 * Null when no rewrite happened (bare alias, `not_arra_thing`, canonical
 * `oracle_*`) and null for non-deprecated aliases (`arra_*`).
 */
export function deprecatedAliasWarning(name: string): string | null {
  const clean = name.trim();
  const resolved = resolveToolName(clean);
  if (resolved === clean) return null;
  if (!DEPRECATED_PREFIXES.some((prefix: string) => clean.startsWith(prefix))) return null;
  return `[MCP] tool alias "${clean}" is deprecated — use "${resolved}" (removal planned next release)`;
}

/**
 * Notice for a prefix that has been removed, or null.
 *
 * Names the replacement, because the alternative is a tool-not-found that gives the caller
 * nothing to act on.
 */
export function retiredAliasNotice(name: string): string | null {
  const clean = name.trim();
  for (const prefix of RETIRED_PREFIXES) {
    if (!clean.startsWith(prefix)) continue;
    const suffix = clean.slice(prefix.length).trim();
    if (!suffix) return null;
    const target = suffix.startsWith('oracle_') ? suffix : `oracle_${suffix}`;
    return `[MCP] tool alias "${clean}" was REMOVED — call "${target}" instead. `
      + 'The muninn_ prefix was retired after its deprecation release (#2824).';
  }
  return null;
}

/**
 * Resolve an inbound tool name, emitting one notice per call when a deprecated or retired
 * alias was used. `log` is injectable for tests; production passes nothing so the notice
 * reaches the operator on stderr.
 */
export function resolveInboundToolName(name: string, log: (m: string) => void = console.error): string {
  const retired = retiredAliasNotice(name);
  if (retired) {
    log(retired);
    // Returned unchanged on purpose: the alias is gone, and quietly resolving it anyway would
    // make the removal cosmetic. The caller still gets tool-not-found — now with a reason.
    return name.trim();
  }
  const warning = deprecatedAliasWarning(name);
  if (warning) log(warning);
  return resolveToolName(name);
}

/**
 * The one notice for an inbound alias, deprecated or retired.
 *
 * `tool-alias-warn.ts` keeps the message in exactly one place so the non-MCP surfaces — the
 * settings API, `arra.config.json`, the ORACLE_*_TOOLS env vars — cannot drift into a second
 * dialect of the same notice. Retiring `muninn_` would otherwise make every one of those
 * surfaces go silent about it, which is the opposite of the point.
 */
export function aliasNotice(name: string): string | null {
  return deprecatedAliasWarning(name) ?? retiredAliasNotice(name);
}
