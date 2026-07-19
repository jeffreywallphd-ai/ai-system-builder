import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AssetImplementationBackingResourceBundleV1 } from "../../../../contracts/asset-implementation";
import {
  readSystemFoundationBackingResourceBundle,
  SYSTEM_FOUNDATION_BACKING_RESOURCE_BUNDLES,
  SYSTEM_FOUNDATION_BACKING_RESOURCE_BUNDLES_BY_VERSION,
  SYSTEM_FOUNDATION_V2_BACKING_RESOURCE_BUNDLES,
} from "../system-foundation-backing-resource-catalog";
import {
  readSystemFoundationFunctionalDefault,
  SYSTEM_FOUNDATION_FUNCTIONAL_DEFAULTS,
  SYSTEM_FOUNDATION_FUNCTIONAL_DEFAULTS_BY_VERSION,
  SYSTEM_FOUNDATION_V2_FUNCTIONAL_DEFAULTS,
} from "../system-foundation-functional-default-catalog";
import {
  SYSTEM_FOUNDATION_LAYOUT_PRESETS,
  SYSTEM_FOUNDATION_PACK_MANIFEST,
  SYSTEM_FOUNDATION_PACK_V2_MANIFEST,
} from "../system-packs";

describe("system foundation version-addressed catalogs", () => {
  it("preserves 1.0.0 defaults while independently addressing every 2.0.0 definition", () => {
    assert.equal(
      SYSTEM_FOUNDATION_FUNCTIONAL_DEFAULTS.length,
      SYSTEM_FOUNDATION_PACK_MANIFEST.assets.length,
    );
    assert.equal(
      SYSTEM_FOUNDATION_V2_FUNCTIONAL_DEFAULTS.length,
      SYSTEM_FOUNDATION_PACK_V2_MANIFEST.assets.length,
    );
    assert.equal(SYSTEM_FOUNDATION_FUNCTIONAL_DEFAULTS_BY_VERSION.size, 2);
    assert.equal(SYSTEM_FOUNDATION_BACKING_RESOURCE_BUNDLES_BY_VERSION.size, 2);
    assert.equal(
      SYSTEM_FOUNDATION_BACKING_RESOURCE_BUNDLES.size,
      SYSTEM_FOUNDATION_PACK_MANIFEST.assets.length,
    );
    assert.equal(
      SYSTEM_FOUNDATION_V2_BACKING_RESOURCE_BUNDLES.size,
      SYSTEM_FOUNDATION_PACK_V2_MANIFEST.assets.length,
    );

    for (const manifest of [
      SYSTEM_FOUNDATION_PACK_MANIFEST,
      SYSTEM_FOUNDATION_PACK_V2_MANIFEST,
    ]) {
      for (const entry of manifest.assets) {
        const definitionId = String(entry.definition.definitionId);
        const descriptor = readSystemFoundationFunctionalDefault(
          definitionId,
          manifest.version,
        );
        const bundle = readSystemFoundationBackingResourceBundle(
          definitionId,
          manifest.version,
        );
        assert.ok(descriptor, `${definitionId}@${manifest.version}`);
        assert.equal(descriptor.definitionVersion, manifest.version);
        assert.ok(bundle, `${definitionId}@${manifest.version}`);
        assert.equal(
          parseJsonFile(bundle, "other/definition.json").definition.version,
          manifest.version,
        );
      }
    }

    assert.equal(
      readSystemFoundationFunctionalDefault("builtin.system.system")
        ?.definitionVersion,
      "1.0.0",
    );
    assert.equal(
      readSystemFoundationFunctionalDefault(
        "builtin.layout.application.standard",
      )?.definitionVersion,
      "2.0.0",
    );
  });

  it("publishes executable layout structure and responsive styling as backing resources", () => {
    for (const preset of SYSTEM_FOUNDATION_LAYOUT_PRESETS) {
      const bundle = readSystemFoundationBackingResourceBundle(
        preset.presetId,
        "2.0.0",
      );
      assert.ok(bundle, preset.presetId);
      const structure = parseJsonFile(bundle, "frontend/structure.json");
      assert.equal(structure.definitionVersion, "2.0.0");
      assert.equal(
        structure.layoutPreset.schemaVersion,
        "system-foundation-layout.v1",
      );
      assert.equal(structure.layoutPreset.presetId, preset.presetId);
      assert.deepEqual(structure.layoutPreset.sourceOrder, preset.sourceOrder);
      assert.deepEqual(structure.layoutPreset.responsive, preset.responsive);
      assert.deepEqual(structure.layoutPreset.slots, preset.slots);
      assert.deepEqual(
        structure.fixture.regions,
        preset.slots.map((slot) => slot.displayName),
      );

      const css = fileContent(bundle, "frontend/styles.css");
      assert.match(css, /display: grid/);
      assert.match(css, /grid-template-areas:/);
      assert.match(css, /@media \(min-width: 48rem\)/);
      assert.match(css, /@media \(min-width: 80rem\)/);
      for (const slot of preset.slots) {
        assert.match(css, new RegExp(`data-slot="${slot.slotId}"`));
        assert.match(css, new RegExp(`grid-area: ${slot.slotId}`));
      }
    }
  });

  it("keeps exact root implementation resources distinct between releases", () => {
    const v1 = readSystemFoundationBackingResourceBundle(
      "builtin.system.system",
      "1.0.0",
    );
    const v2 = readSystemFoundationBackingResourceBundle(
      "builtin.system.system",
      "2.0.0",
    );
    assert.ok(v1);
    assert.ok(v2);
    assert.notEqual(
      fileContent(v1, "other/definition.json"),
      fileContent(v2, "other/definition.json"),
    );
    assert.equal(
      parseJsonFile(v1, "other/definition.json").definition.slots,
      undefined,
    );
    assert.equal(
      parseJsonFile(v2, "other/definition.json").definition.slots[0].slotId,
      "application-shell",
    );
  });
});

function fileContent(
  bundle: AssetImplementationBackingResourceBundleV1,
  path: string,
): string {
  const file = bundle.files.find((candidate) => candidate.path === path);
  assert.ok(file, path);
  return file.content;
}

function parseJsonFile(
  bundle: AssetImplementationBackingResourceBundleV1,
  path: string,
): any {
  return JSON.parse(fileContent(bundle, path));
}
