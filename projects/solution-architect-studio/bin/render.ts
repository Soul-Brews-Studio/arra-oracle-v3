#!/usr/bin/env bun
/**
 * CLI entry point for the diagram rendering step.
 *
 * Usage: bun run render <slug>
 * Resolves output/<slug>/diagram.mmd and produces output/<slug>/diagram.svg.
 */

import { join } from "node:path";
import { RenderError, renderDiagram, resolveOutputDir } from "../src/render";

const projectRoot = join(import.meta.dir, "..");

async function main() {
  const slug = process.argv[2];

  if (!slug) {
    console.error("Usage: bun run render <slug>");
    console.error("  e.g. bun run render public-web-app-rds");
    process.exit(1);
  }

  const outputDir = resolveOutputDir(slug, projectRoot);

  try {
    const { svgPath } = await renderDiagram(outputDir);
    console.log(`Rendered ${svgPath}`);
  } catch (err) {
    if (err instanceof RenderError) {
      console.error(`Render failed: ${err.message}`);
    } else {
      console.error(err);
    }
    process.exit(1);
  }
}

main();
