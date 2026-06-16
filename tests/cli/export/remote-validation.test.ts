import { expect, test } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseRemoteExportOptions, renderRemoteExportHelp, runRemoteExportCommand } from "../../../src/cli/commands/export.ts";

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

test("export CLI accepts output path aliases", () => {
  expect(parseRemoteExportOptions(["--output", "a.json"]).output).toBe("a.json");
  expect(parseRemoteExportOptions(["--out", "b.json"]).output).toBe("b.json");
  expect(parseRemoteExportOptions(["-o", "c.json"]).output).toBe("c.json");
  expect(parseRemoteExportOptions(["-o=d.json"]).output).toBe("d.json");
  expect(renderRemoteExportHelp()).toContain("--output, --out, -o");
});
