import { describe, expect, test } from "bun:test";
import { validateManifest } from "../../../cli/src/plugin/manifest.ts";
import { manifest } from "./_fixtures.ts";

describe("validateManifest", () => {
  test("rejects invalid names", () => {
    expect(() => validateManifest(manifest({ name: "Bad Name" }))).toThrow("manifest.name");
  });
});
