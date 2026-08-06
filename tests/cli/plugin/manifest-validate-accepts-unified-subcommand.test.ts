import { describe, expect, test } from "bun:test";
import { validateManifest } from "../../../cli/src/plugin/manifest.ts";
import { manifest } from "./_fixtures.ts";

describe("validateManifest", () => {
  test("accepts a valid unified CLI subcommand manifest", () => {
    expect(() => validateManifest(manifest({
      sdk: undefined,
      cliSubcommands: [{ command: "demo", help: "demo help", handler: "run" }],
    }))).not.toThrow();
  });
});
