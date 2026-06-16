import { describe, expect, test } from "bun:test";
import { shouldShowSetupWizard } from "../../../frontend/src/components/SetupWizard";

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
});
