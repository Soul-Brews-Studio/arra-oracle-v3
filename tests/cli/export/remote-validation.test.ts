import { expect, test } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runRemoteExportCommand } from "../../../src/cli/commands/export.ts";

test("export CLI rejects formats outside the requested remote export set", async () => {
  await expect(runRemoteExportCommand([
    "--url", "http://oracle.test",
    "--collection", "oracle_documents",
    "--format", "xml",
    "--output", join(tmpdir(), "bad.xml"),
  ])).rejects.toThrow("unsupported format: xml");
});

test("export CLI rejects invalid retry counts", async () => {
  await expect(runRemoteExportCommand([
    "--url", "http://oracle.test",
    "--collection", "oracle_documents",
    "--format", "json",
    "--output", join(tmpdir(), "bad.json"),
    "--retries", "-1",
  ])).rejects.toThrow("--retries must be a non-negative integer");
});
