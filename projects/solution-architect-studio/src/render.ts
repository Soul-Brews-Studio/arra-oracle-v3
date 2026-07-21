/**
 * Diagram rendering step (Core Components #3 in PLAN.md).
 *
 * Mechanical only: takes a design's output directory, reads its diagram.mmd,
 * and renders diagram.svg alongside it via `mmdc` (mermaid-cli). No agent
 * judgment happens here — this is the deterministic half of the pipeline,
 * kept separate so diagrams stay reproducible and diffable in git.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

export interface RenderResult {
  mmdPath: string;
  svgPath: string;
}

export class RenderError extends Error {}

/**
 * Common install locations for a system-installed Chrome/Chromium, used as
 * a fallback when Puppeteer's own bundled browser isn't present (e.g. in
 * sandboxes without network access to download it). Only consulted if
 * PUPPETEER_EXECUTABLE_PATH isn't already set by the caller's environment.
 */
const SYSTEM_CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

function resolvePuppeteerExecutablePath(): string | undefined {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  return SYSTEM_CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
}

/**
 * Renders `<outputDir>/diagram.mmd` to `<outputDir>/diagram.svg`.
 *
 * Invokes `mmdc` as a subprocess (via `bunx --bun`) rather than any
 * programmatic API: mermaid-cli's package is a thin wrapper around a
 * puppeteer-driven CLI, so shelling out is the reliable integration point.
 */
export async function renderDiagram(outputDir: string): Promise<RenderResult> {
  const mmdPath = join(outputDir, "diagram.mmd");
  const svgPath = join(outputDir, "diagram.svg");

  if (!existsSync(mmdPath)) {
    throw new RenderError(`No diagram.mmd found at ${mmdPath}`);
  }

  const executablePath = resolvePuppeteerExecutablePath();

  const proc = Bun.spawn(
    ["bunx", "--bun", "mmdc", "-i", mmdPath, "-o", svgPath],
    {
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        ...(executablePath
          ? { PUPPETEER_EXECUTABLE_PATH: executablePath }
          : {}),
      },
    }
  );

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new RenderError(
      `mmdc failed (exit ${exitCode}) rendering ${mmdPath}:\n${stderr}`
    );
  }

  if (!existsSync(svgPath)) {
    throw new RenderError(
      `mmdc reported success but ${svgPath} was not created`
    );
  }

  return { mmdPath, svgPath };
}

/**
 * Resolves a design slug (e.g. "public-web-app-rds") to its output
 * directory under this project's own output/ tree.
 */
export function resolveOutputDir(slug: string, projectRoot: string): string {
  return join(projectRoot, "output", slug);
}
