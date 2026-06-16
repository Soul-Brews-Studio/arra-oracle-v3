import { describe, expect, test } from "bun:test";
import { shouldShowSetupWizard } from "../../../frontend/src/components/SetupWizard";
import { StepBody, setupSteps } from "../../../frontend/src/components/SetupWizardContent";
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
  });

  test("labels the final wizard step as done with dashboard guidance", () => {
    expect(setupSteps[3]).toBe("Done");
    const html = htmlFor(<StepBody step={3} providers={[]} config={null} />);
    expect(html).toContain("Vector dashboard");
    expect(html).toContain("Vector Settings");
  });
});
