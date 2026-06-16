import { expect, test } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runRemoteExportCommand } from "../../../src/cli/commands/export.ts";

test("export CLI rejects formats outside the requested remote export set", async () => {
  await expect(runRemoteExportCommand([
    "--url", "http://oracle.test",
    "--collection", "oracle_documents",
    "--format", "csv",
    "--output", join(tmpdir(), "bad.csv"),
  ])).rejects.toThrow("unsupported format: csv");
});
