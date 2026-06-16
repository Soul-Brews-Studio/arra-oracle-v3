import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runRemoteExportCommand } from "../../../src/cli/commands/export.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.length = 0;
});

function tempFile(name: string): string {
  const root = mkdtempSync(join(tmpdir(), "arra-export-cli-"));
  roots.push(root);
  return join(root, name);
}

describe("export CLI remote engine", () => {
  test("posts an export-app run and writes the downloaded payload", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const output = tempFile("oracle_documents.jsonl");
    const fetcher = async (input: string, init?: RequestInit): Promise<Response> => {
      calls.push({ url: input, init });
      if (input.endsWith("/api/v1/export/app/run")) {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toEqual({ collection: "oracle_documents", format: "jsonl" });
        return Response.json({ downloadUrl: "/api/v1/export/app/download/job-1" });
      }
      return new Response('{"id":"doc-1"}\n', {
        headers: { "content-type": "application/x-ndjson" },
      });
    };

    const message = await runRemoteExportCommand([
      "--url", "http://oracle.test/",
      "--collection", "oracle_documents",
      "--format", "jsonl",
      "--output", output,
    ], { fetch: fetcher, env: { ARRA_API_TOKEN: "secret" } });

    expect(message).toContain("exported oracle_documents (jsonl)");
    expect(readFileSync(output, "utf8")).toBe('{"id":"doc-1"}\n');
    expect(calls.map((call) => call.url)).toEqual([
      "http://oracle.test/api/v1/export/app/run",
      "http://oracle.test/api/v1/export/app/download/job-1",
    ]);
    expect((calls[0]!.init!.headers as Record<string, string>).authorization).toBe("Bearer secret");
  });
});
