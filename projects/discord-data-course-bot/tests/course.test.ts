import { describe, expect, it } from "bun:test";
import { buildSystemPrompt, formatCurriculum, type CourseModule } from "../src/course";

const sample: CourseModule[] = [
  { title: "1. Intro", topics: ["a", "b"] },
  { title: "2. Advanced", topics: ["c"] },
];

describe("formatCurriculum", () => {
  it("renders each module title with its indented topics", () => {
    const out = formatCurriculum(sample);
    expect(out).toContain("1. Intro");
    expect(out).toContain("  - a");
    expect(out).toContain("  - b");
    expect(out).toContain("2. Advanced");
    expect(out).toContain("  - c");
  });

  it("separates modules with a blank line", () => {
    const out = formatCurriculum(sample);
    expect(out).toContain("b\n\n2. Advanced");
  });
});

describe("buildSystemPrompt", () => {
  it("embeds the curriculum in the system prompt", () => {
    const prompt = buildSystemPrompt(sample);
    expect(prompt).toContain("1. Intro");
    expect(prompt).toContain("2. Advanced");
  });

  it("instructs the model to ground answers in the curriculum", () => {
    const prompt = buildSystemPrompt(sample);
    expect(prompt.toLowerCase()).toContain("curriculum");
  });
});
