import { describe, expect, it } from "vitest";

import { resolveThinClientWorkspaceRouteBoundary } from "../routes/workspaceRouteBoundary";

describe("thin-client workspace route boundary decisions", () => {
  it("hides workspace-required pages from the visible shell while workspace state is not ready", () => {
    for (const page of ["models", "assets", "artifacts", "image-generation"] as const) {
      for (const status of ["loading", "missing", "unavailable", "error"] as const) {
        expect(resolveThinClientWorkspaceRouteBoundary(page, status)).toEqual({ blocked: true, visibleActivePage: undefined });
      }
    }
  });

  it("preserves visible page state for ready workspace routes and non-workspace pages", () => {
    expect(resolveThinClientWorkspaceRouteBoundary("models", "ready")).toEqual({ blocked: false, visibleActivePage: "models" });
    expect(resolveThinClientWorkspaceRouteBoundary("security", "missing")).toEqual({ blocked: false, visibleActivePage: "security" });
  });
});
