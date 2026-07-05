import type { PluginManifest } from "./types.ts";

export function parseManifest(raw: unknown): PluginManifest {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("manifest must be a JSON object");
  }
  return raw as PluginManifest;
}

export function validateManifest(m: PluginManifest): void {
  if (!m.name || !/^[a-z0-9-]+$/.test(m.name)) {
    throw new Error(`manifest.name must match /^[a-z0-9-]+$/, got: ${JSON.stringify(m.name)}`);
  }
  if (!m.version || !/^\d+\.\d+\.\d+/.test(m.version)) {
    throw new Error(`manifest.version must be semver, got: ${JSON.stringify(m.version)}`);
  }
  if (!m.entry || typeof m.entry !== "string") {
    throw new Error(`manifest.entry must be a string path`);
  }
  if (m.sdk !== undefined && typeof m.sdk !== "string") {
    throw new Error(`manifest.sdk must be a semver range string`);
  }
  if (m.cliSubcommands !== undefined) {
    if (!Array.isArray(m.cliSubcommands)) {
      throw new Error("manifest.cliSubcommands must be an array");
    }
    for (const subcommand of m.cliSubcommands) {
      if (!subcommand.command || typeof subcommand.command !== "string") {
        throw new Error("manifest.cliSubcommands.command must be a string");
      }
      if (!subcommand.help || typeof subcommand.help !== "string") {
        throw new Error("manifest.cliSubcommands.help must be a string");
      }
      if (subcommand.handler !== undefined && typeof subcommand.handler !== "string") {
        throw new Error("manifest.cliSubcommands.handler must be a string");
      }
    }
  }
}
