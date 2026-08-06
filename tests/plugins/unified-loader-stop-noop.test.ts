import { describe, expect, test } from "bun:test";
import { loadUnifiedPlugins } from "../../src/plugins/unified-loader.ts";

describe("UnifiedRuntime.stop", () => {
  test("resolves as a no-op for manifest-only plugin runtimes", async () => {
    const runtime = await loadUnifiedPlugins({ dirs: ["/tmp/no-such-unified-stop-dir"] });
    await expect(runtime.stop()).resolves.toBeUndefined();
  });
});
