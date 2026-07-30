import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "../../../../testing/node-test";
import {
  ASSET_LIBRARY_DEFAULT_FILTERS,
  ASSET_LIBRARY_DETAIL_EXPANSIONS,
  assetLibraryFiltersAreActive,
  createAssetLibraryQuery,
  formatAssetLibraryBoolean,
  formatAssetLibraryDate,
  formatAssetLibraryLabel,
  getAssetLibraryAdvancedSections,
} from "../index";

describe("asset library browser helpers", () => {
  it("builds definition queries from active filters only", () => {
    expect(createAssetLibraryQuery(ASSET_LIBRARY_DEFAULT_FILTERS)).toEqual({ limit: 50 });
    expect("includeValidation" in createAssetLibraryQuery(ASSET_LIBRARY_DEFAULT_FILTERS)).toBe(false);
    expect(createAssetLibraryQuery({
      searchText: "  document  ",
      assetType: "document",
      assetFamily: "resource-backed",
      lifecycleStatus: "published",
      builtIn: "built-in",
      packId: "all",
      sourceLayer: "all",
      categoryId: "all",
    })).toEqual({
      limit: 50,
      searchText: "document",
      assetTypes: ["document"],
      assetFamilies: ["resource-backed"],
      lifecycleStatuses: ["published"],
      builtIn: "built-in",
    });
    expect(createAssetLibraryQuery({
      searchText: "",
      assetType: "not-a-real-type",
      assetFamily: "not-a-real-family",
      lifecycleStatus: "not-a-real-status",
      builtIn: "all",
      packId: "all",
      sourceLayer: "all",
      categoryId: "all",
    })).toEqual({ limit: 50 });
  });

  it("keeps list queries read-only and free of validation or mutation operations", () => {
    const query = createAssetLibraryQuery({
      searchText: "workflow",
      assetType: "workflow",
      assetFamily: "behavioral",
      lifecycleStatus: "draft",
      builtIn: "custom",
      packId: "all",
      sourceLayer: "all",
      categoryId: "all",
    }) as Record<string, unknown>;
    const serialized = JSON.stringify(query);

    expect(query.includeValidation).toBeUndefined();
    expect(/create|update|delete|register|seed|import|finalize|publish|execute|run|scan|sync|repair|install|start|train/i.test(serialized)).toBe(false);

    const querySource = readFileSync(join(process.cwd(), "modules/ui/shared/asset-library/assetLibraryQueries.ts"), "utf8");
    const browserSource = readFileSync(join(process.cwd(), "modules/ui/shared/asset-library/assetLibraryBrowser.ts"), "utf8");
    const forbiddenOperations = /\b(?:createAsset|updateAsset|deleteAsset|registerAsset|seedBuiltInAssetDefinitions|importAsset|finalizeAsset|publishAsset|executeAsset|runAsset|scanResources)\b/i;
    expect(forbiddenOperations.test(querySource)).toBe(false);
    expect(forbiddenOperations.test(browserSource)).toBe(false);
  });

  it("detects active filters", () => {
    expect(assetLibraryFiltersAreActive(ASSET_LIBRARY_DEFAULT_FILTERS)).toBe(false);
    expect(assetLibraryFiltersAreActive({ ...ASSET_LIBRARY_DEFAULT_FILTERS, searchText: "asset" })).toBe(true);
    expect(assetLibraryFiltersAreActive({ ...ASSET_LIBRARY_DEFAULT_FILTERS, builtIn: "custom" })).toBe(true);
    expect(assetLibraryFiltersAreActive({ ...ASSET_LIBRARY_DEFAULT_FILTERS, categoryId: "ui-structure" })).toBe(true);
  });

  it("reports advanced section availability without expanding validation by default", () => {
    expect([...ASSET_LIBRARY_DETAIL_EXPANSIONS]).toEqual([
      "aiContext",
      "configurationSchema",
      "ports",
      "requirements",
      "provenance",
      "metadata",
    ]);
    expect(getAssetLibraryAdvancedSections(undefined)).toEqual([]);
    expect(getAssetLibraryAdvancedSections({
      id: "asset@1.0.0",
      definitionId: "asset",
      version: "1.0.0",
      displayName: "Asset",
      assetType: "tool",
      assetFamily: "behavioral",
      lifecycleStatus: "draft",
      builtIn: false,
      aiContextSummary: { capabilityCount: 0, limitationCount: 0, safetyNoteCount: 0 },
      validationSummary: { issueCount: 0, errorCount: 0, warningCount: 0, status: "valid" },
    })).toEqual(["aiContext", "validation"]);
  });

  it("formats labels, booleans, and safe dates for shared presentation", () => {
    expect(formatAssetLibraryLabel("resource-backed")).toBe("Resource Backed");
    expect(formatAssetLibraryLabel(undefined)).toBe("Not specified");
    expect(formatAssetLibraryBoolean(true)).toBe("Yes");
    expect(formatAssetLibraryBoolean(undefined)).toBe("Not specified");
    expect(formatAssetLibraryDate("not a date")).toBeUndefined();
  });

  it("uses reflow-safe filter and card grids without a side detail layout", () => {
    const styles = readFileSync(
      join(
        process.cwd(),
        "modules/ui/shared/styles/components/feature-surfaces.css",
      ),
      "utf8",
    );
    const desktopFeature = readFileSync(
      join(
        process.cwd(),
        "apps/desktop/src/renderer/features/asset-library/components/AssetLibraryFeature.tsx",
      ),
      "utf8",
    );
    const thinFeature = readFileSync(
      join(
        process.cwd(),
        "apps/thin-client/src/features/asset-library/components/AssetLibraryFeature.tsx",
      ),
      "utf8",
    );

    expect(styles).toMatch(
      /grid-template-columns:\s*repeat\([\s\S]*?auto-fit[\s\S]*?minmax\(min\(100%,\s*10\.5rem\),\s*1fr\)/,
    );
    expect(styles).toMatch(
      /\.asset-library-list\s*\{[\s\S]*?repeat\(auto-fit,\s*minmax\(min\(100%,\s*18rem\),\s*1fr\)\)/,
    );
    expect(styles).not.toMatch(/\.asset-library-layout\s*\{/);
    expect(desktopFeature).not.toMatch(/className="asset-library-layout"/);
    expect(thinFeature).not.toMatch(/className="asset-library-layout"/);
    expect(desktopFeature).toMatch(/aria-haspopup="dialog"/);
    expect(thinFeature).toMatch(/aria-haspopup="dialog"/);
  });
});
