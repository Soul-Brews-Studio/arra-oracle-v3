import type { PluginManifest } from "./types.ts";

const TIERS = new Set(["core", "standard", "extra"]);
const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD", "ALL"]);

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
  if (!m.sdk || typeof m.sdk !== "string") {
    throw new Error(`manifest.sdk must be a semver range string`);
  }
  if (m.tier !== undefined && !TIERS.has(m.tier)) {
    throw new Error(`manifest.tier must be core, standard, or extra; got: ${JSON.stringify(m.tier)}`);
  }
  if (m.enabled !== undefined && typeof m.enabled !== "boolean") {
    throw new Error(`manifest.enabled must be a boolean`);
  }
  if (m.seedMenu !== undefined && typeof m.seedMenu !== "boolean") {
    throw new Error(`manifest.seedMenu must be a boolean`);
  }
  if (m.api) {
    if (!m.api.path || typeof m.api.path !== "string" || !m.api.path.startsWith("/")) {
      throw new Error(`manifest.api.path must be an absolute path`);
    }
    for (const method of m.api.methods ?? []) {
      if (typeof method !== "string" || !HTTP_METHODS.has(method.toUpperCase())) {
        throw new Error(`manifest.api.methods contains invalid method: ${JSON.stringify(method)}`);
      }
    }
  }
  if (m.lifecycle) {
    if (m.lifecycle.start !== undefined && typeof m.lifecycle.start !== "boolean") {
      throw new Error(`manifest.lifecycle.start must be a boolean`);
    }
    if (m.lifecycle.stop !== undefined && typeof m.lifecycle.stop !== "boolean") {
      throw new Error(`manifest.lifecycle.stop must be a boolean`);
    }
  }
}
