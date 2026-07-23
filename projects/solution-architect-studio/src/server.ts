#!/usr/bin/env bun
/**
 * HTTP service (Interfaces: CLI + Skill + HTTP Service, PLAN.md #100-115).
 *
 * Thin Elysia routing around the existing render core (src/render.ts) — no
 * render logic duplicated here, the same core the CLI (bin/render.ts) calls.
 *
 * V1 security boundary per PLAN.md's resolved decision: binds to localhost
 * only (127.0.0.1), not reachable beyond the local machine. That's the whole
 * boundary — there is deliberately no auth middleware, token, or password
 * scheme here.
 */

import { Elysia } from "elysia";
import { join } from "node:path";
import { RenderError, renderDiagram, resolveOutputDir } from "./render";

const projectRoot = join(import.meta.dir, "..");

/**
 * Slugs are directory names under output/ — reject anything that could
 * escape that directory (path separators, `..`) rather than trusting the
 * path param blindly, even though the surface is localhost-only.
 */
function isValidSlug(slug: string): boolean {
  return slug.length > 0 && !slug.includes("/") && !slug.includes("\\") && slug !== "..";
}

export const app = new Elysia().post("/render/:slug", async ({ params, set }) => {
  const { slug } = params;

  if (!isValidSlug(slug)) {
    set.status = 400;
    return { ok: false, slug, error: `Invalid slug: ${slug}` };
  }

  const outputDir = resolveOutputDir(slug, projectRoot);

  try {
    const { svgPath } = await renderDiagram(outputDir);
    return { ok: true, slug, svgPath };
  } catch (err) {
    if (err instanceof RenderError) {
      // Missing diagram.mmd means the slug doesn't have a design to render
      // yet — that's a client-facing "not found", everything else RenderError
      // reports (e.g. mmdc failing) is a server-side rendering failure.
      const notFound = err.message.startsWith("No diagram.mmd found");
      set.status = notFound ? 404 : 500;
      return { ok: false, slug, error: err.message };
    }
    set.status = 500;
    return { ok: false, slug, error: String(err) };
  }
});

const DEFAULT_PORT = 4790;
const port = Number(process.env.PORT ?? DEFAULT_PORT);

if (import.meta.main) {
  app.listen({ hostname: "127.0.0.1", port });
  console.log(
    `solution-architect-studio HTTP service listening on http://127.0.0.1:${port}`
  );
}
