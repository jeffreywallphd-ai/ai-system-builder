import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AssetImplementationBackingResourceBundleV1 } from "../../../../contracts/asset-implementation";
import {
  readSystemFoundationBackingResourceProgram,
  readSystemFoundationBackingResourceBundle,
  SYSTEM_FOUNDATION_BACKING_RESOURCE_BUNDLES,
  SYSTEM_FOUNDATION_BACKING_RESOURCE_BUNDLES_BY_VERSION,
  SYSTEM_FOUNDATION_V2_BACKING_RESOURCE_BUNDLES,
  SYSTEM_FOUNDATION_V3_BACKING_RESOURCE_BUNDLES,
} from "../system-foundation-backing-resource-catalog";
import {
  readSystemFoundationFunctionalDefault,
  SYSTEM_FOUNDATION_FUNCTIONAL_DEFAULTS,
  SYSTEM_FOUNDATION_FUNCTIONAL_DEFAULTS_BY_VERSION,
  SYSTEM_FOUNDATION_V2_FUNCTIONAL_DEFAULTS,
  SYSTEM_FOUNDATION_V3_FUNCTIONAL_DEFAULTS,
} from "../system-foundation-functional-default-catalog";
import {
  SYSTEM_FOUNDATION_LAYOUT_PRESETS,
  SYSTEM_FOUNDATION_PACK_MANIFEST,
  SYSTEM_FOUNDATION_PACK_V2_MANIFEST,
  SYSTEM_FOUNDATION_PACK_V3_MANIFEST,
} from "../system-packs";

describe("system foundation version-addressed catalogs", () => {
  it("adds composable current-version UI regions without mutating legacy definitions", () => {
    const legacyCard = SYSTEM_FOUNDATION_PACK_MANIFEST.assets.find(
      (entry) => entry.definition.definitionId === "builtin.ui.card",
    )?.definition;
    const currentCard = SYSTEM_FOUNDATION_PACK_V2_MANIFEST.assets.find(
      (entry) => entry.definition.definitionId === "builtin.ui.card",
    )?.definition;
    assert.equal(legacyCard?.slots, undefined);
    assert.deepEqual(
      currentCard?.slots?.map((slot) => String(slot.slotId)),
      ["media", "content", "actions"],
    );
    assert.deepEqual(
      currentCard?.configurationSchema?.fields.map((field) => field.fieldId),
      [
        "title",
        "description",
        "mediaPlacement",
        "emphasis",
        "clickBehavior",
        "padding",
      ],
    );
    assert.deepEqual(
      currentCard?.slots?.find((slot) => slot.slotId === "content")
        ?.acceptedAssetTypes,
      ["ui-component", "page", "feature"],
    );
    const currentProgram = readSystemFoundationBackingResourceProgram(
      "builtin.ui.card",
      "2.0.0",
    );
    assert.equal(currentProgram?.semanticElement, "article");
    assert.deepEqual(
      currentProgram?.regions.map((region) => region.slotId),
      ["media", "content", "actions"],
    );
    assert.deepEqual(
      readSystemFoundationBackingResourceProgram(
        "builtin.ui.card",
        "1.0.0",
      )?.regions,
      [],
    );
  });

  it("preserves prior defaults while independently addressing every exact release", () => {
    assert.equal(
      SYSTEM_FOUNDATION_FUNCTIONAL_DEFAULTS.length,
      SYSTEM_FOUNDATION_PACK_MANIFEST.assets.length,
    );
    assert.equal(
      SYSTEM_FOUNDATION_V2_FUNCTIONAL_DEFAULTS.length,
      SYSTEM_FOUNDATION_PACK_V2_MANIFEST.assets.length,
    );
    assert.equal(
      SYSTEM_FOUNDATION_V3_FUNCTIONAL_DEFAULTS.length,
      SYSTEM_FOUNDATION_PACK_V3_MANIFEST.assets.length,
    );
    assert.equal(SYSTEM_FOUNDATION_FUNCTIONAL_DEFAULTS_BY_VERSION.size, 3);
    assert.equal(SYSTEM_FOUNDATION_BACKING_RESOURCE_BUNDLES_BY_VERSION.size, 3);
    assert.equal(
      SYSTEM_FOUNDATION_BACKING_RESOURCE_BUNDLES.size,
      SYSTEM_FOUNDATION_PACK_MANIFEST.assets.length,
    );
    assert.equal(
      SYSTEM_FOUNDATION_V2_BACKING_RESOURCE_BUNDLES.size,
      SYSTEM_FOUNDATION_PACK_V2_MANIFEST.assets.length,
    );
    assert.equal(
      SYSTEM_FOUNDATION_V3_BACKING_RESOURCE_BUNDLES.size,
      SYSTEM_FOUNDATION_PACK_V3_MANIFEST.assets.length,
    );

    for (const manifest of [
      SYSTEM_FOUNDATION_PACK_MANIFEST,
      SYSTEM_FOUNDATION_PACK_V2_MANIFEST,
      SYSTEM_FOUNDATION_PACK_V3_MANIFEST,
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
      "3.0.0",
    );
    assert.equal(
      readSystemFoundationFunctionalDefault(
        "builtin.layout.application.standard",
      )?.definitionVersion,
      "3.0.0",
    );
  });

  it("keeps v2 layout references exact while projecting v3 layout resources", () => {
    const v2 = readSystemFoundationBackingResourceBundle(
      "builtin.layout.application.navigation",
      "2.0.0",
    );
    const v3 = readSystemFoundationBackingResourceBundle(
      "builtin.layout.application.navigation",
      "3.0.0",
    );
    assert.ok(v2);
    assert.ok(v3);
    const v2Layout = parseJsonFile(v2, "frontend/structure.json").layoutPreset;
    const v3Layout = parseJsonFile(v3, "frontend/structure.json").layoutPreset;
    assert.equal(v2Layout.slots[2].acceptedDefinitionRefs[0].version, "2.0.0");
    assert.equal(v3Layout.slots[2].acceptedDefinitionRefs[0].version, "3.0.0");
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
    const v2RootDefault = readSystemFoundationFunctionalDefault(
      "builtin.system.system",
      "2.0.0",
    );
    assert.equal(v2RootDefault?.previewKind, "layout");
    assert.equal(v2RootDefault?.runtimeKind, "declarative-engine");
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
    assert.equal(
      parseJsonFile(v2, "frontend/structure.json").semanticElement,
      "application",
    );
    assert.equal(
      v1.files.some((file) => file.path === "frontend/structure.json"),
      false,
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
