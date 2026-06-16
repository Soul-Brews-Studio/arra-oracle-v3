import { describe, expect, test } from "bun:test";
import { arraCli, arraHttpRoute } from "../arra/index.ts";

const config = {
  dbBackend: "custom" as const,
  embedderBackend: "remote" as const,
  remoteEmbedderUrl: "https://example.invalid/embed",
};

describe("built-in arra plugin command registry", () => {
  test("renders the shared CLI/menu/API registry from maw arra commands", async () => {
    const result = await arraCli({ source: "cli", plugin: "arra", args: ["commands"] });

    expect(result.ok).toBe(true);
    expect(result.output).toContain("shared by CLI/menu/API");
    expect(result.output).toContain("commands");
    expect(result.output).toContain("/api/plugins/arra");
    expect(result.output).toContain("vector-config");
  });

  test("commands --json mirrors the HTTP registry payload", async () => {
    const result = await arraCli({ source: "cli", plugin: "arra", args: ["commands", "--json"], config });
    const http = arraHttpRoute({ source: "api", plugin: "arra", config });
    const payload = JSON.parse(result.output ?? "{}") as typeof http.body;

    expect(result.ok).toBe(true);
    expect(payload.surface).toBe("cli");
    expect(payload.verbs.map((verb) => verb.name)).toEqual(http.body.verbs.map((verb) => verb.name));
    expect(payload.backends).toEqual(http.body.backends);
    expect(payload.remoteEmbedderConfigured).toBe(true);
  });

  test("normalizes modern maw help and version flags", async () => {
    const help = await arraCli({ source: "cli", plugin: "arra", args: ["--help"] });
    const version = await arraCli({ source: "cli", plugin: "arra", args: ["--version"] });

    expect(help.output).toContain("maw arra <command>");
    expect(help.output).toContain("commands");
    expect(version).toEqual({ ok: true, output: "arra 1.0.0" });
  });
});
