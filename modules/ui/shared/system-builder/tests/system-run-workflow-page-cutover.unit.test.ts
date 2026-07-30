import { readFileSync } from "node:fs";
import { describe, expect, it } from "../../../../testing/node-test";

const pagePaths = [
  "apps/desktop/src/renderer/pages/SystemBuilderPage.tsx",
  "apps/thin-client/src/pages/SystemBuilderPage.tsx",
] as const;

describe("published lifecycle host-page cutover", () => {
  it("mounts lifecycle controls in Publish and removes the standalone Run & Test surface", () => {
    for (const path of pagePaths) {
      const source = readFileSync(path, "utf8");
      expect(source).toContain("<SystemPublishWorkspace");
      expect(source).toContain("SystemPublishedLifecycleClient");
      expect(source).not.toContain("<SystemRunWorkflow");
      expect(source).not.toContain("SystemRunWorkflowClient");
      expect(source).not.toContain('label: "Run & Test"');
      expect(source).not.toContain("ConversationRunTestTab");
      expect(source).not.toContain("<SystemDataRunTest");
      expect(source).not.toContain("<SystemReviewRunTest");
      expect(source).not.toContain("<SystemDeploymentWorkflow");
    }
  });
});
