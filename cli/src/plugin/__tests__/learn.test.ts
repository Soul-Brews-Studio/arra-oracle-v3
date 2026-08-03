import { afterEach, describe, expect, test } from "bun:test";
import type { InvokeContext } from "../types.ts";
import handler from "../../plugins/learn/index.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function captureRequest(response: Record<string, unknown>) {
  let body: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    body = JSON.parse(String(init?.body));
    return Response.json(response);
  }) as typeof fetch;
  return () => body;
}

function context(args: string[]): InvokeContext {
  return { source: "cli", args };
}

describe("arra learn CLI", () => {
  test("forwards explicit project scope and reports the created file", async () => {
    const captured = captureRequest({ id: "learning_test", file: "ψ/memory/learnings/test.md" });

    const result = await handler(context([
      "the lesson",
      "--concepts", "origin-tool-observation,scope-project,confidence-verified",
      "--source", "rrr:soul-brews-studio/arra-oracle-v3",
      "--project", "github.com/soul-brews-studio/arra-oracle-v3",
    ]));

    expect(result.ok).toBe(true);
    expect(captured()).toEqual({
      pattern: "the lesson",
      concepts: ["origin-tool-observation", "scope-project", "confidence-verified"],
      source: "rrr:soul-brews-studio/arra-oracle-v3",
      project: "github.com/soul-brews-studio/arra-oracle-v3",
    });
    expect(result.output).toContain("file: ψ/memory/learnings/test.md");
  });

  test("rejects --project without a value before calling the API", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return Response.json({});
    }) as typeof fetch;

    const result = await handler(context(["the lesson", "--project"]));

    expect(result).toEqual({ ok: false, error: "--project requires a value" });
    expect(called).toBe(false);
  });
});
