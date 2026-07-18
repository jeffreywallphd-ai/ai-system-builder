import { describe, expect, it } from "../../../../testing/node-test";
import {
  ASSET_IMPLEMENTATION_BACKING_RESOURCE_ROLES,
  normalizeAssetImplementationBackingResourceBundle,
} from "../../../../contracts/asset-implementation";
import {
  readSystemFoundationBackingResourceBundle,
  readSystemFoundationBackingResourceProgram,
  SYSTEM_FOUNDATION_BACKING_RESOURCE_BUNDLES,
} from "../system-foundation-backing-resource-catalog";
import { SYSTEM_FOUNDATION_FUNCTIONAL_DEFAULTS } from "../system-foundation-functional-default-catalog";
import { SYSTEM_FOUNDATION_PACK_MANIFEST } from "../system-packs";

describe("system foundation backing resource catalog", () => {
  it("provides real bounded implementation resources for every foundation asset", () => {
    expect(SYSTEM_FOUNDATION_BACKING_RESOURCE_BUNDLES.size).toBe(
      SYSTEM_FOUNDATION_PACK_MANIFEST.assets.length,
    );
    for (const descriptor of SYSTEM_FOUNDATION_FUNCTIONAL_DEFAULTS) {
      const bundle = readSystemFoundationBackingResourceBundle(
        descriptor.definitionId,
      );
      expect(bundle).toBeDefined();
      const normalized = normalizeAssetImplementationBackingResourceBundle(
        bundle!,
      );
      expect(normalized.files.some((file) => file.path === "other/definition.json")).toBe(true);
      expect(
        normalized.files.every((file) =>
          ASSET_IMPLEMENTATION_BACKING_RESOURCE_ROLES.includes(file.role),
        ),
      ).toBe(true);

      const frontend = ["layout", "form", "data", "state", "conversation"].includes(
        descriptor.previewKind,
      );
      expect(
        normalized.files.some((file) => file.role === "frontend-structure"),
      ).toBe(frontend);
      expect(
        normalized.files.some((file) => file.role === "frontend-style"),
      ).toBe(frontend);

      const backend =
        ["logic", "workflow", "data", "policy"].includes(descriptor.facetKind) ||
        ["workflow", "policy"].includes(descriptor.previewKind);
      expect(
        normalized.files.some((file) => file.role === "backend-logic"),
      ).toBe(backend);
    }
  });

  it("derives the runtime preview program from the canonical backing resources", () => {
    for (const descriptor of SYSTEM_FOUNDATION_FUNCTIONAL_DEFAULTS) {
      const program = readSystemFoundationBackingResourceProgram(
        descriptor.definitionId,
      );
      expect(program?.definitionId).toBe(descriptor.definitionId);
      expect(program?.previewKind).toBe(descriptor.previewKind);
      expect(program?.previewFixture).toEqual(descriptor.previewFixture);
      if (descriptor.previewKind === "policy") {
        expect(program?.failClosed).toBe(true);
        expect(program?.backendSteps.length).toBeGreaterThan(0);
      }
    }
  });
});
