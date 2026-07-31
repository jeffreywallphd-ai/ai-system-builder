import { describe, expect, it } from "../../../../../modules/testing/node-test";

import { desktopPageDefinitions, desktopPageRequiresWorkspace } from "../routes/desktopPages";

describe("desktop page workspace metadata", () => {
  it("marks workspace product pages including Systems as workspace-required and keeps Settings global", () => {
    expect(desktopPageRequiresWorkspace("artifacts")).toBe(true);
    expect(desktopPageRequiresWorkspace("assets")).toBe(true);
    expect(desktopPageRequiresWorkspace("models")).toBe(true);
    expect(desktopPageRequiresWorkspace("image-generation")).toBe(true);
    expect(desktopPageRequiresWorkspace("systems")).toBe(true);
    expect(desktopPageRequiresWorkspace("settings")).toBe(false);
    expect(desktopPageDefinitions.filter((page) => page.requiresWorkspace).map((page) => page.key)).toEqual([
      "artifacts",
      "assets",
      "user-library",
      "models",
      "image-generation",
      "systems",
    ]);
  });
});
