import { describe, expect, test } from "bun:test";
import { parseManifest } from "../../../cli/src/plugin/manifest.ts";

describe("parseManifest", () => {
  test("rejects non-object manifests", () => {
    expect(() => parseManifest(null)).toThrow("manifest must be a JSON object");
  });
});
