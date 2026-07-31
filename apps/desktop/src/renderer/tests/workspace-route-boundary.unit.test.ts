import { describe, expect, it } from "../../../../../modules/testing/node-test";

import { resolveDesktopWorkspaceRouteBoundary } from "../routes/workspaceRouteBoundary";

describe("desktop workspace route boundary decisions", () => {
  it("hides workspace-required pages from the visible shell while workspace state is not ready", () => {
    for (const status of ["loading", "missing", "unavailable", "error"] as const) {
      expect(resolveDesktopWorkspaceRouteBoundary("models", status)).toEqual({ blocked: true, visibleActivePage: undefined });
    }
  });

  it("preserves visible page state for ready workspace routes and non-workspace pages", () => {
    expect(resolveDesktopWorkspaceRouteBoundary("models", "ready")).toEqual({ blocked: false, visibleActivePage: "models" });
    expect(resolveDesktopWorkspaceRouteBoundary("settings", "missing")).toEqual({ blocked: false, visibleActivePage: "settings" });
  });
});
