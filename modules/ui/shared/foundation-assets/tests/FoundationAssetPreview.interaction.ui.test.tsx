// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FoundationAssetPreviewBoundary } from "../FoundationAssetPreview";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  vi.restoreAllMocks();
});

describe("FoundationAssetPreviewBoundary", () => {
  it("contains renderer exceptions without leaking details or changing surrounding state", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const surroundingState = "unchanged";

    await render(
      <FoundationAssetPreviewBoundary>
        <ThrowingPreview />
      </FoundationAssetPreviewBoundary>,
    );

    expect(container?.textContent).toContain("Visual preview unavailable");
    expect(container?.textContent).toContain("current draft were not changed");
    expect(container?.textContent).not.toContain("protected-renderer-detail");
    expect(
      container?.querySelector('[data-preview-recovered="true"]'),
    ).not.toBeNull();
    expect(surroundingState).toBe("unchanged");
  });
});

function ThrowingPreview(): ReactNode {
  throw new Error("protected-renderer-detail");
}

async function render(node: ReactNode): Promise<void> {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(node));
}
