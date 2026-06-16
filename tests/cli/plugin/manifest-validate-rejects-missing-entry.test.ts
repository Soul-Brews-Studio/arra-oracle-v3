import { describe, expect, test } from "bun:test";
import { validateManifest } from "../../../cli/src/plugin/manifest.ts";
import { manifest } from "./_fixtures.ts";

describe("validateManifest", () => {
  test("rejects missing entries", () => {
    expect(() => validateManifest(manifest({ entry: "" }))).toThrow("manifest.entry");
  });
});
