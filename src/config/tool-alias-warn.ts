import { aliasNotice } from '../mcp/aliases.ts';

/**
 * Deprecation warnings for the NON-MCP inbound surfaces.
 *
 * `src/mcp/server.ts` warns on its own CallTool path via `resolveInboundToolName`,
 * but that is not the only door a `muninn_` name walks through: the settings API,
 * the `arra.config.json` file and the ORACLE_*_TOOLS env vars all rewrite the
 * alias through `normalizeToolName` and, before this module, did so in silence.
 *
 * The MESSAGE deliberately lives in exactly one place — `aliasNotice`
 * in src/mcp/aliases.ts — so these surfaces can never drift into a second dialect
 * of the same notice. The `[MCP]` tag it carries is kept even here: the noun being
 * labelled is an MCP tool name, whatever transport carried it.
 */

/**
 * Warn once per call. Use at boundaries where each call is a genuinely new
 * operator action — an HTTP PUT, an MCP CallTool — so suppressing a repeat would
 * hide a real second event.
 *
 * Silent for `arra_` (supported, not deprecated) and for canonical `oracle_*`,
 * because `aliasNotice` returns null for both.
 */
export function warnDeprecatedAlias(name: string, log: (m: string) => void = console.error): void {
  const warning = aliasNotice(name);
  if (warning) log(warning);
}

/** Aliases already warned about, keyed by the raw inbound name. */
const warned = new Set<string>();

/**
 * Warn at most once per distinct alias for the life of the process.
 *
 * MANDATORY for the config-file and env paths, not a nicety: the watcher in
 * `tool-groups-watch.ts` polls `loadToolGroupConfig` every 100ms, so those call
 * sites re-read the same persistent input 10x/sec. An unguarded warn there is a
 * log flood, not a notice — one `muninn_` entry would emit ~864k lines/day.
 */
export function warnDeprecatedAliasOnce(name: string, log: (m: string) => void = console.error): void {
  const warning = aliasNotice(name);
  if (!warning || warned.has(name)) return;
  warned.add(name);
  log(warning);
}

/**
 * Warn at most once per distinct key, for warnings that are NOT about aliases.
 *
 * Same mandate as above: anything reached from `loadToolGroupConfig` is on the
 * 100ms watcher path, so an unguarded `console.error` there is ~864k lines/day.
 * `knownTool()` shipped exactly that in #2826 — three lines from this file.
 */
export function warnOnce(key: string, message: string, log: (m: string) => void = console.error): void {
  if (warned.has(key)) return;
  warned.add(key);
  log(message);
}

/**
 * Clear the once-guard. Tests only — the Set is process-global, so without this
 * a test asserting "it warns" would depend on no earlier test having warmed it.
 */
export function resetAliasWarnings(): void {
  warned.clear();
}
