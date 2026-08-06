import { describe, expect, test } from "bun:test";
import { seedUnifiedPluginMenuItems } from "../../src/plugins/unified-loader.ts";

describe("seedUnifiedPluginMenuItems", () => {
  test("returns without opening the database for empty menus", async () => {
    await expect(seedUnifiedPluginMenuItems([])).resolves.toBeUndefined();
  });
});
