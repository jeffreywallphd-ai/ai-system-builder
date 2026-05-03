import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("models feature cleanup", () => {
  it("removes unsafe as never casts from useModelsFeature", () => {
    const source = readFileSync(resolve("apps/desktop/src/renderer/features/models/hooks/useModelsFeature.ts"), "utf8");
    expect(source).not.toContain("as never");
  });

  it("keeps training state out of useModelsFeature", () => {
    const source = readFileSync(resolve("apps/desktop/src/renderer/features/models/hooks/useModelsFeature.ts"), "utf8");
    expect(source).not.toContain("submitTraining");
    expect(source).not.toContain("outputModelName");
    expect(source).not.toContain("datasetArtifactIdsText");
  });
});
