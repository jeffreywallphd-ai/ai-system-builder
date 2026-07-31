import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Systems execution-preview placement", () => {
  it("removes the redundant Plans page without removing controlled plan clients", () => {
    const page = readFileSync(
      "apps/thin-client/src/pages/SystemBuilderPage.tsx",
      "utf8",
    );
    const client = readFileSync(
      "apps/thin-client/src/features/execution-plans/api/thinClientExecutionPlansClient.ts",
      "utf8",
    );
    expect(page).not.toContain("AssetPlansTab");
    expect(page).not.toContain('label: "Plans"');
    expect(page).toContain('label: "Publish"');
    expect(client).toContain("listExecutionPlanSummaries");
  });
});
