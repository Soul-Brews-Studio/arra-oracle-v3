import { describe, expect, test } from "bun:test";
import { shouldShowSetupWizard } from "../../../frontend/src/components/SetupWizard";
import { SetupWizardCostEstimate } from "../../../frontend/src/components/SetupWizardCostEstimate";
import { StepBody, setupSteps } from "../../../frontend/src/components/SetupWizardContent";
import { buildIndexStartBody, primaryCollectionKey } from "../../../frontend/src/components/setupWizardIndex";
import { buildProviderConfigPatch, recommendedProvider } from "../../../frontend/src/components/setupWizardProvider";
import { htmlFor } from "../_render";

describe("SetupWizard first-run detection", () => {
  test("shows only when docs are empty and vector index is disabled or empty", () => {
    expect(
      shouldShowSetupWizard(
        { total_docs: 0, vector: { enabled: false, count: 0 } },
        { config: { collections: {} }, doc_counts: {} },
      ),
    ).toBe(true);
    expect(
      shouldShowSetupWizard(
        { total_docs: 7, vector: { enabled: false, count: 0 } },
        { config: { collections: {} }, doc_counts: {} },
      ),
    ).toBe(false);
    expect(
      shouldShowSetupWizard(
        { total_docs: 0, vector: { enabled: true, count: 5 } },
        { config: { collections: {} }, doc_counts: {} },
      ),
    ).toBe(false);
    expect(
      shouldShowSetupWizard(
        { total_docs: 0, vector: { enabled: false, count: 0 } },
        { resolution: { wizard: "optional", providerPrompt: false }, config: { collections: {} }, doc_counts: {} },
      ),
    ).toBe(false);
  });


  test("builds a vector config patch for the selected first-run provider", () => {
    expect(recommendedProvider([{ type: "openai" }, { type: "gemini", available: true }])?.type).toBe("gemini");
    expect(buildProviderConfigPatch({
      config: {
        embedder: { fallback: "openai" },
        collections: { bge: { model: "bge-m3", provider: "ollama" } },
      },
    }, "gemini")).toEqual({
      embedder: { default: "gemini", fallback: "openai" },
      collections: { bge: { model: "bge-m3", provider: "gemini" } },
    });
  });

  test("renders local default backend instead of first-run provider radios", () => {
    const html = htmlFor(<StepBody
      step={1}
      config={{ resolution: { engine: "sqlite-vec", providerPrompt: false, wizard: "optional" } }}
    />);
    expect(html).toContain("Local vector backend selected: sqlite-vec");
    expect(html).not.toContain('name="setup-provider"');
    expect(html).toContain("No embedding/provider choice is required");
  });

  test("renders semantic empty and done wizard states", () => {
    const empty = htmlFor(<StepBody step={1} config={null} />);
    const done = htmlFor(<StepBody step={3} config={null} />);

    expect(empty).toContain("Local vector backend selected: lancedb");
    expect(empty).toContain("border-ok-border bg-ok-bg");
    expect(done).toContain("First-run setup complete");
    expect(done).toContain("border-ok-border bg-ok-bg text-ok-text");
  });

  test("builds vector index start body from selected source and vault path", () => {
    const config = { config: { collections: { bge: { enabled: false }, qwen: { enabled: true } } } };
    expect(primaryCollectionKey(config)).toBe("qwen");
    expect(buildIndexStartBody(config, "vault", "/repo/oracle")).toEqual({
      model: "qwen",
      source: "vault",
      repoRoot: "/repo/oracle",
    });
    expect(buildIndexStartBody(config, "sqlite", "/ignored")).toEqual({ model: "qwen", source: "sqlite" });
  });

  test("renders vault source controls for first-run indexing", () => {
    const html = htmlFor(<StepBody
      step={2}
      config={{ config: { collections: { bge: { model: "bge-m3" } } } }}
      indexSource="vault"
      repoRoot="/repo/oracle"
      onIndexSource={() => {}}
      onRepoRoot={() => {}}
    />);
    expect(html).toContain("Index source");
    expect(html).toContain("Vault path");
    expect(html).toContain("/repo/oracle");
    expect(html).toContain("Configured collections: bge");
  });


  test("renders first-run preflight cost estimate", () => {
    const html = htmlFor(<SetupWizardCostEstimate
      provider="gemini"
      initialEstimate={{
        estimatedUsd: 0,
        formula: "42 docs × ~500 tokens/doc ≈ 21K tokens",
        provider: "gemini",
        recommendation: "Gemini free tier is recommended before paid remote embedding.",
        fallbackSummary: "Fallback chain gemini stays free/local for this estimate.",
      }}
    />);
    expect(html).toContain("Preflight cost before Start indexing");
    expect(html).toContain("gemini: Free / local");
    expect(html).toContain("21K tokens");
    expect(html).toContain("Gemini free tier");
  });

  test("labels the final wizard step as done with dashboard guidance", () => {
    expect(setupSteps[3]).toBe("Done");
    const html = htmlFor(<StepBody step={3} config={null} />);
    expect(html).toContain("Vector dashboard");
    expect(html).toContain("Vector Settings");
  });
});
