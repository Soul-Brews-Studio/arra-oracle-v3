import { describe, expect, test } from "bun:test";
import { validateManifest } from "../manifest.ts";
import type { PluginManifest } from "../types.ts";

const base: PluginManifest = { name: "probe", version: "1.0.0", entry: "./index.ts", sdk: "^0.0.1" };

describe("validateManifest timeoutMs", () => {
  test("accepts a positive number", () => {
    expect(() => validateManifest({ ...base, timeoutMs: 20000 })).not.toThrow();
  });

  test("accepts an omitted timeoutMs", () => {
    expect(() => validateManifest(base)).not.toThrow();
  });

  test("rejects zero", () => {
    expect(() => validateManifest({ ...base, timeoutMs: 0 })).toThrow(/timeoutMs must be a positive number/);
  });

  test("rejects a negative value", () => {
    expect(() => validateManifest({ ...base, timeoutMs: -1 })).toThrow(/positive number/);
  });

  test("rejects a non-number (e.g. a string from malformed plugin.json)", () => {
    // Named cast (rule: no inline cast in member access): a malformed manifest as
    // it would arrive from untyped JSON, to prove the runtime guard fires.
    const malformed = { ...base, timeoutMs: "20000" } as unknown as PluginManifest;
    expect(() => validateManifest(malformed)).toThrow(/positive number/);
  });
});
