import { describe, expect, test } from "bun:test";
import {
  exportCommand,
  renderRemoteExportHelp,
  renderRemoteExportVersion,
} from "../../../src/cli/commands/export.ts";

async function captureOutput(action: () => Promise<number>): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  const originalWrite = process.stdout.write;
  const originalLog = console.log;
  const originalError = console.error;
  let stdout = "";
  let stderr = "";
  (process.stdout as unknown as { write: (chunk: unknown) => boolean }).write = (chunk) => {
    stdout += String(chunk);
    return true;
  };
  console.log = (...parts: unknown[]) => { stdout += `${parts.join(" ")}\n`; };
  console.error = (...parts: unknown[]) => { stderr += `${parts.join(" ")}\n`; };
  try {
    const code = await action();
    return { code, stdout, stderr };
  } finally {
    process.stdout.write = originalWrite;
    console.log = originalLog;
    console.error = originalError;
  }
}

describe("export CLI help and version", () => {
  test("renders standalone remote export help with graph, retry, and version flags", () => {
    const help = renderRemoteExportHelp();
    expect(help).toContain("bun run export -- --url <oracle-v2-url>");
    expect(help).toContain("--include-graph");
    expect(help).toContain("--retries <count>");
    expect(help).toContain("--version, -v, -V");
  });

  test("prints version without requiring export flags", async () => {
    const version = renderRemoteExportVersion();
    const result = await captureOutput(() => exportCommand(["--version"]));
    expect(result).toEqual({ code: 0, stdout: `${version}\n`, stderr: "" });
    expect(version).toStartWith("arra export v");
  });
});
