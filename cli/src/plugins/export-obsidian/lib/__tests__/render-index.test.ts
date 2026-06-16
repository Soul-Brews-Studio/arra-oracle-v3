import { describe, expect, test } from "bun:test";
import { renderIndex } from "../render-index.ts";
import type { VaultStats } from "../types.ts";

const stats: VaultStats = {
  total: 42,
  byType: { learning: 20, retro: 15, principle: 7 },
  byProject: { "Soul-Brews-Studio/arra-oracle-v3": 30, "Soul-Brews-Studio/maw-js": 12 },
  topConcepts: [
    { name: "menu_ui", count: 9 },
    { name: "drizzle", count: 5 },
  ],
  topLinked: [
    { slug: "doc-a", linkCount: 8 },
    { slug: "doc-b", linkCount: 5 },
  ],
  generatedAt: new Date("2026-04-19T10:00:00Z"),
};

describe("renderIndex", () => {
  const out = renderIndex(stats);

  test("has title and total", () => {
    expect(out).toContain("# ARRA Vault Index");
    expect(out).toContain("Total docs: 42");
  });

  test("includes generation timestamp", () => {
    expect(out).toContain("Generated: 2026-04-19T10:00:00.000Z");
  });

  test("renders by-type breakdown sorted by count desc", () => {
    const learningIdx = out.indexOf("- learning: 20");
    const retroIdx = out.indexOf("- retro: 15");
    const principleIdx = out.indexOf("- principle: 7");
    expect(learningIdx).toBeGreaterThan(-1);
    expect(retroIdx).toBeGreaterThan(learningIdx);
    expect(principleIdx).toBeGreaterThan(retroIdx);
  });

  test("renders concept hub wikilinks to _concepts/", () => {
    expect(out).toContain("[[_concepts/menu-ui|menu_ui]] (9)");
    expect(out).toContain("[[_concepts/drizzle|drizzle]] (5)");
  });

  test("renders top linked docs when provided", () => {
    expect(out).toContain("[[doc-a]] (8 links)");
    expect(out).toContain("[[doc-b]] (5 links)");
  });

  test("contains generator signature (Oracle Rule 6)", () => {
    expect(out.toLowerCase()).toContain("arra-oracle-v3");
  });

  test("is deterministic for identical stats", () => {
    const a = renderIndex(stats);
    const b = renderIndex({ ...stats, generatedAt: new Date("2026-04-19T10:00:00Z") });
    expect(a).toBe(b);
  });
});
