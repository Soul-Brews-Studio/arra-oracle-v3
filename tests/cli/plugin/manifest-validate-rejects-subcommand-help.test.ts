import { describe, expect, test } from "bun:test";
import { validateManifest } from "../../../cli/src/plugin/manifest.ts";
import { manifest } from "./_fixtures.ts";

describe("validateManifest", () => {
  test("rejects cliSubcommands without help strings", () => {
    expect(() => validateManifest(manifest({ cliSubcommands: [{ command: "demo", help: "" }] }))).toThrow("cliSubcommands.help");
  });
});
