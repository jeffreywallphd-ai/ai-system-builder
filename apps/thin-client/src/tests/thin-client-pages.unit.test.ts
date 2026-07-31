import { describe, expect, it } from "vitest";

import { thinClientPageDefinitions, thinClientPageRequiresWorkspace } from "../routes/thinClientPages";

describe("thin-client page workspace metadata", () => {
  it("marks resource-backed pages as workspace-required and keeps global pages open", () => {
    expect(thinClientPageRequiresWorkspace("artifacts")).toBe(true);
    expect(thinClientPageRequiresWorkspace("assets")).toBe(true);
    expect(thinClientPageRequiresWorkspace("systems")).toBe(true);
    expect(thinClientPageRequiresWorkspace("models")).toBe(true);
    expect(thinClientPageRequiresWorkspace("image-generation")).toBe(true);
    expect(thinClientPageRequiresWorkspace("home")).toBe(false);
    expect(thinClientPageRequiresWorkspace("security")).toBe(false);
    expect(thinClientPageRequiresWorkspace("settings")).toBe(false);
    expect(thinClientPageDefinitions.filter((page) => page.requiresWorkspace).map((page) => page.key)).toEqual([
      "systems",
      "artifacts",
      "assets",
      "user-library",
      "image-generation",
      "models",
    ]);
  });
});
