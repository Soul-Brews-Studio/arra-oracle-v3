import { describe, expect, test } from "bun:test";
import { normalizeUnifiedPluginManifest } from "../../src/plugins/unified-manifest.ts";

function manifest(lifecycle: Record<string, unknown>) {
  return {
    name: "lifecycle-schema",
    version: "1.0.0",
    entry: "./index.ts",
    lifecycle,
  };
}

describe("unified plugin lifecycle manifest schema", () => {
  test("rejects invalid lifecycle hook values", () => {
    expect(() => normalizeUnifiedPluginManifest(manifest({ init: true }))).toThrow("lifecycle.init");
    expect(() => normalizeUnifiedPluginManifest(manifest({ destroy: true }))).toThrow("lifecycle.destroy");
    expect(() => normalizeUnifiedPluginManifest(manifest({ start: "yes" }))).toThrow("lifecycle.start");
    expect(() => normalizeUnifiedPluginManifest(manifest({ stop: "no" }))).toThrow("lifecycle.stop");
  });
});
