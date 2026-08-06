import { describe, expect, test } from "bun:test";
import { validateManifest } from "../../../cli/src/plugin/manifest.ts";
import { manifest } from "./_fixtures.ts";

describe("validateManifest", () => {
  test("rejects non-string sdk values", () => {
    expect(() => validateManifest(manifest({ sdk: 1 as never }))).toThrow("manifest.sdk");
  });
});
