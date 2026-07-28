import { describe, expect, test } from "bun:test";
import { renderFrontmatter } from "../render-frontmatter.ts";
import type { DocMeta } from "../types.ts";

const base: DocMeta = {
  arra_id: "01-abc",
  arra_type: "learning",
  arra_project: "Soul-Brews-Studio/arra-oracle-v3",
  arra_created: "2026-04-19T10:00:00Z",
  muninn_concepts: ["menu_ui", "drizzle"],
  arra_model: "bge-m3",
  arra_similarity_threshold: 0.75,
};

describe("renderFrontmatter", () => {
  test("emits fenced YAML block with all fields", () => {
    const out = renderFrontmatter(base);
    expect(out.startsWith("---\n")).toBe(true);
    expect(out.endsWith("---\n")).toBe(true);
    expect(out).toContain("arra_id: 01-abc");
    expect(out).toContain("arra_type: learning");
    expect(out).toContain("arra_model: bge-m3");
    expect(out).toContain("arra_similarity_threshold: 0.75");
  });

  test("merges type + concepts into tags and dedupes", () => {
    const out = renderFrontmatter({ ...base, muninn_concepts: ["learning", "menu_ui"] });
    expect(out).toContain("tags: [learning, menu_ui]");
  });

  test("quotes strings containing colons or quotes", () => {
    const tricky: DocMeta = {
      ...base,
      arra_id: "id: with colon",
      arra_project: 'name with "quote"',
    };
    const out = renderFrontmatter(tricky);
    expect(out).toContain('arra_id: "id: with colon"');
    expect(out).toContain('arra_project: "name with \\"quote\\""');
  });

  test("empty concepts array renders as []", () => {
    const out = renderFrontmatter({ ...base, muninn_concepts: [] });
    expect(out).toContain("muninn_concepts: []");
    expect(out).toContain("tags: [learning]");
  });

  test("is deterministic (same input → same output)", () => {
    expect(renderFrontmatter(base)).toBe(renderFrontmatter({ ...base }));
  });

  test("omits arra_project and arra_created when not provided", () => {
    const out = renderFrontmatter({
      arra_id: "x",
      arra_type: "retro",
      muninn_concepts: [],
      arra_model: "bge-m3",
      arra_similarity_threshold: 0.8,
    });
    expect(out).not.toContain("arra_project");
    expect(out).not.toContain("arra_created");
  });
});
