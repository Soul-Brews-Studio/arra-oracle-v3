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
    const http = await arraHttpRoute({ source: "api", plugin: "arra", config });
    type RegistryBody = { surface: string; verbs: Array<{ name: string }>; backends: unknown; remoteEmbedderConfigured: boolean };
    const payload = JSON.parse(result.output ?? "{}") as RegistryBody;
    const httpBody = http.body as RegistryBody;

    expect(result.ok).toBe(true);
    expect(payload.surface).toBe("cli");
    expect(payload.verbs.map((verb) => verb.name)).toEqual(httpBody.verbs.map((verb) => verb.name));
    expect(payload.backends).toEqual(httpBody.backends);
    expect(payload.remoteEmbedderConfigured).toBe(true);
  });

  test("runs shared commands through the menu API payload", async () => {
    const version = await arraHttpRoute({ source: "api", plugin: "arra", args: { command: "version" } });
    const registry = await arraHttpRoute({
      source: "api",
      plugin: "arra",
      args: { command: "commands", json: true },
      config,
    });
    const unknown = await arraHttpRoute({ source: "api", plugin: "arra", args: { command: "missing" } });

    expect(version.body).toEqual({ ok: true, command: "version", output: "arra 1.0.0" });
    expect((registry.body as { surface: string }).surface).toBe("api");
    expect((registry.body as { verbs: Array<{ name: string }> }).verbs.map((verb) => verb.name)).toContain("commands");
    expect(unknown).toEqual({ ok: false, status: 400, error: "unknown arra command: missing" });
  });

  test("normalizes modern maw help and version flags", async () => {
    const help = await arraCli({ source: "cli", plugin: "arra", args: ["--help"] });
    const version = await arraCli({ source: "cli", plugin: "arra", args: ["--version"] });

    expect(help.output).toContain("maw arra <command>");
    expect(help.output).toContain("commands");
    expect(version).toEqual({ ok: true, output: "arra 1.0.0" });
  });
});
