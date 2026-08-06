import { describe, expect, test } from "bun:test";
import { validateManifest } from "../../../cli/src/plugin/manifest.ts";
import { manifest } from "./_fixtures.ts";

describe("validateManifest", () => {
  test("rejects cliSubcommands with non-string handlers", () => {
    expect(() => validateManifest(manifest({
      cliSubcommands: [{ command: "demo", help: "help", handler: 1 as never }],
    }))).toThrow("cliSubcommands.handler");
  });
});
