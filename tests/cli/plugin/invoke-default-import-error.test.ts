import { describe, expect, test } from "bun:test";
import { invokePlugin } from "../../../cli/src/plugin/invoke.ts";
import { loaded } from "./_fixtures.ts";

describe("invokePlugin", () => {
  test("returns import errors as InvokeResult failures", async () => {
    const result = await invokePlugin({ ...loaded(), entryPath: "/tmp/no-such-plugin-entry.ts" }, { source: "cli", args: [] });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Cannot find module");
  });
});
