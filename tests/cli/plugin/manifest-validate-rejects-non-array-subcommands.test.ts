import { describe, expect, test } from "bun:test";
import { validateManifest } from "../../../cli/src/plugin/manifest.ts";
import { manifest } from "./_fixtures.ts";

describe("validateManifest", () => {
  test("rejects non-array cliSubcommands", () => {
    expect(() => validateManifest(manifest({ cliSubcommands: {} as never }))).toThrow("cliSubcommands must be an array");
  });
});
