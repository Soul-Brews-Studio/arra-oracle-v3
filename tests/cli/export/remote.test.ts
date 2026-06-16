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

  test("supports CSV remote export downloads", async () => {
    const output = tempFile("oracle_documents.csv");
    const fetcher = async (input: string, init?: RequestInit): Promise<Response> => {
      if (input.endsWith("/api/v1/export/app/run")) {
        expect(JSON.parse(String(init?.body))).toEqual({ collection: "oracle_documents", format: "csv" });
        return Response.json({ downloadUrl: "/api/v1/export/app/download/job-csv" });
      }
      return new Response('id,title\n"doc-1","CSV"\n', {
        headers: { "content-type": "text/csv; charset=utf-8" },
      });
    };

    const message = await runRemoteExportCommand([
      "--url", "http://oracle.test",
      "--collection", "oracle_documents",
      "--format", "csv",
      "--output", output,
    ], { fetch: fetcher });

    expect(message).toContain("exported oracle_documents (csv)");
    expect(readFileSync(output, "utf8")).toBe('id,title\n"doc-1","CSV"\n');
  });

  test("sends includeGraph when the graph CLI flag is present", async () => {
    const output = tempFile("oracle_documents.json");
    let body: unknown;
    const fetcher = async (_input: string, init?: RequestInit): Promise<Response> => {
      body = JSON.parse(String(init?.body));
      return Response.json({ content: { ok: true } });
    };

    const message = await runRemoteExportCommand([
      "--url=http://oracle.test",
      "--collection", "oracle_documents",
      "--format", "json",
      "--output", output,
      "--graph",
    ], { fetch: fetcher });

    expect(message).toContain("exported oracle_documents (json)");
    expect(body).toEqual({ collection: "oracle_documents", format: "json", includeGraph: true });
    expect(readFileSync(output, "utf8")).toBe('{\n  "ok": true\n}\n');
  });

  test("retries transient run and download failures", async () => {
    const output = tempFile("oracle_documents.md");
    let runAttempts = 0;
    let downloadAttempts = 0;
    const fetcher = async (input: string): Promise<Response> => {
      if (input.endsWith("/api/v1/export/app/run")) {
        runAttempts += 1;
        if (runAttempts === 1) throw new TypeError("socket closed");
        return Response.json({ downloadUrl: "/api/v1/export/app/download/job-2" });
      }
      downloadAttempts += 1;
      if (downloadAttempts === 1) return new Response("not ready", { status: 503 });
      return new Response("# Export\n");
    };

    const message = await runRemoteExportCommand([
      "--url", "http://oracle.test",
      "--collection", "oracle_documents",
      "--format", "markdown",
      "--output", output,
      "--retries", "1",
      "--retry-delay-ms", "0",
    ], { fetch: fetcher });

    expect(message).toContain("exported oracle_documents (markdown)");
    expect(readFileSync(output, "utf8")).toBe("# Export\n");
    expect(runAttempts).toBe(2);
    expect(downloadAttempts).toBe(2);
  });
});
