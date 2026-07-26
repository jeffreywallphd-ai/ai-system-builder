import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "../../../../testing/node-test";

const pagePaths = [
  "apps/desktop/src/renderer/pages/AssetLibraryPage.tsx",
  "apps/thin-client/src/pages/AssetLibraryPage.tsx",
] as const;

describe("Asset area tab consolidation", () => {
  for (const pagePath of pagePaths) {
    it(`${pagePath} exposes Studio and Saved without redundant Create or Drafts tabs`, () => {
      const source = readFileSync(resolve(process.cwd(), pagePath), "utf8");
      expect(source).toContain('id: "studio"');
      expect(source).toContain('label: "Studio"');
      expect(source).toContain('id: "saved"');
      expect(source).toContain('label: "Saved"');
      expect(source).toContain('id: "customizations"');
      expect(source).not.toContain('id: "create"');
      expect(source).not.toContain('id: "drafts"');
      expect(source).toContain('setActiveTabId("studio")');
      expect(source).toContain("initialDraftId={studioDraftId}");
    });
  }

  it("keeps Studio, Saved, and Customizations reflow-safe at narrow and zoomed layouts", () => {
    const styles = readFileSync(
      resolve(
        process.cwd(),
        "modules/ui/shared/styles/components/feature-surfaces.css",
      ),
      "utf8",
    );

    expect(styles).toMatch(
      /\.asset-studio__editor-grid\s*\{[\s\S]*?repeat\(auto-fit,\s*minmax\(min\(22rem,\s*100%\),\s*1fr\)\)/,
    );
    expect(styles).toMatch(
      /\.asset-studio__saved-grid\s*\{[\s\S]*?repeat\(auto-fit,\s*minmax\(min\(18rem,\s*100%\),\s*1fr\)\)/,
    );
    expect(styles).toMatch(
      /@media \(max-width:\s*42rem\)[\s\S]*?\.asset-studio__saved-search,[\s\S]*?\.asset-studio__saved-card dl[\s\S]*?grid-template-columns:\s*1fr/,
    );
    expect(styles).toMatch(
      /@media \(max-width:\s*42rem\)[\s\S]*?\.asset-customizer__search[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    );
    expect(styles).toMatch(
      /\.asset-studio__actions\s*\{[\s\S]*?flex-wrap:\s*wrap/,
    );
  });
});
