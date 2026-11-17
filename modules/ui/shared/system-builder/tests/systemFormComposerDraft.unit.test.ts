import { describe, expect, it } from "../../../../testing/node-test";
import {
  ASSET_PLACEMENT_SCHEMA_VERSION,
  normalizeAssetId,
  normalizeAssetSlotId,
  type AssetInstance,
  type AssetSlotDefinition,
} from "../../../../contracts/asset";
import type { SystemBuilderComposerAsset } from "../../../../contracts/system-builder";
import {
  commitSystemComposerDraft,
  createSystemComposerDraftHistory,
  undoSystemComposerDraft,
  type SystemComposerDraft,
} from "../systemComposerDraft";
import {
  FORM_COMPOSER_FOUNDATION_ASSET_IDS as ids,
  FORM_COMPOSER_FOUNDATION_VERSION as version,
  readSystemForms,
} from "../systemFormComposerDraft";

const ref = (id: string) => ({
  kind: "asset-definition-version" as const,
  id: normalizeAssetId(id),
  version,
});
const instanceRef = (id: string) => ({ kind: "asset-instance" as const, id: normalizeAssetId(id) });
const assetInstance = (id: string, definitionId: string): AssetInstance => ({
  instanceId: normalizeAssetId(id),
  definitionRef: ref(definitionId),
  lifecycleStatus: "draft",
  provenance: { sourceKind: "human-authored" },
});
const slot = (slotId: string, child: string, maxItems = 8): AssetSlotDefinition => ({
  schemaVersion: "asset-slot-definition.v1",
  slotId: normalizeAssetSlotId(slotId),
  displayName: slotId,
  cardinality: { minItems: 0, maxItems },
  acceptedDefinitionRefs: [ref(child)],
});
function asset(
  definitionId: string,
  slots: readonly AssetSlotDefinition[],
  layoutRole?: SystemBuilderComposerAsset["layoutRole"],
): SystemBuilderComposerAsset {
  return {
    definitionRef: ref(definitionId), definitionId, version,
    displayName: definitionId, description: "Test asset",
    assetType: layoutRole === "page-layout" ? "page" : "ui-component",
    assetFamily: "structural", lifecycleStatus: "published", builtIn: true,
    slots, ports: [], layoutRole,
    compatibility: { status: "compatible" },
    implementationAvailability: "trusted-system-foundation",
    previewAvailability: "trusted-declarative",
  };
}
const shellId = "builtin.layout.application.standard";
function fixture() {
  const shell = asset(shellId, [
    { ...slot("top-bar", ids.page, 1), acceptedDefinitionRefs: undefined, acceptedAssetTypes: ["page", "ui-component"] },
    slot("content", ids.page),
  ], "application-shell");
  const assets = {
    page: asset(ids.page, [slot("content", ids.section)], "page-layout"),
    section: asset(ids.section, [slot("content", ids.form)]),
    form: asset(ids.form, [slot("fields", ids.step)]),
    step: asset(ids.step, []),
  };
  const draft: SystemComposerDraft = {
    instances: [
      assetInstance("system.root", "builtin.system.system"),
      assetInstance("system.shell", shellId),
      assetInstance("system.original-page", ids.page),
    ],
    bindings: [],
    placements: [
      { schemaVersion: ASSET_PLACEMENT_SCHEMA_VERSION, placementId: normalizeAssetId("place.shell"),
        parentInstanceRef: instanceRef("system.root"), slotId: normalizeAssetSlotId("application-shell"),
        childInstanceRef: instanceRef("system.shell"), order: 0 },
      { schemaVersion: ASSET_PLACEMENT_SCHEMA_VERSION, placementId: normalizeAssetId("place.original-page"),
        parentInstanceRef: instanceRef("system.shell"), slotId: normalizeAssetSlotId("content"),
        childInstanceRef: instanceRef("system.original-page"), order: 0 },
    ],
    structure: { schemaVersion: "system-builder-structure.v1", profile: "interactive", layoutPresetRef: ref(shellId) },
  };
  return { draft, assets, catalog: [shell, ...Object.values(assets)] };
}
function addPlacedForm(draft: SystemComposerDraft, suffix: string, order: number): SystemComposerDraft {
  const path = [
    [`form.${suffix}.page`, ids.page, "system.shell", "content", order],
    [`form.${suffix}.section`, ids.section, `form.${suffix}.page`, "content", 0],
    [`form.${suffix}.form`, ids.form, `form.${suffix}.section`, "content", 0],
    [`form.${suffix}.step`, ids.step, `form.${suffix}.form`, "fields", 0],
  ] as const;
  return {
    ...draft,
    instances: [...draft.instances, ...path.map(([id, definitionId]) => assetInstance(id, definitionId))],
    placements: [...draft.placements, ...path.map(([id, , parent, slotId, order]) => ({
      schemaVersion: ASSET_PLACEMENT_SCHEMA_VERSION,
      placementId: normalizeAssetId(`place.${id}`),
      parentInstanceRef: instanceRef(parent),
      childInstanceRef: instanceRef(id),
      slotId: normalizeAssetSlotId(slotId),
      order,
    }))],
  };
}

describe("Form Composer draft placements", () => {
  it("reads two forms on separate Canvas pages in placement order without changing the draft", () => {
    const f = fixture();
    const first = addPlacedForm(f.draft, "intake", 1);
    const draft = addPlacedForm(first, "survey", 2);
    const forms = readSystemForms(draft, f.catalog);
    expect(forms.map(({page, form, steps}) => [
      page?.instanceId, form.instanceId, steps.map((step) => step.instanceId),
    ])).toEqual([
      ["form.intake.page", "form.intake.form", ["form.intake.step"]],
      ["form.survey.page", "form.survey.form", ["form.survey.step"]],
    ]);
    expect(draft.placements.filter((edge) => edge.parentInstanceRef.id === "system.shell")
      .map((edge) => [edge.childInstanceRef.id, edge.slotId, edge.order])).toEqual([
      ["system.original-page", "content", 0], ["form.intake.page", "content", 1], ["form.survey.page", "content", 2],
    ]);
    const beforeSwitch = JSON.stringify(draft);
    expect(readSystemForms(draft, f.catalog)).toEqual(forms);
    expect(JSON.stringify(draft)).toBe(beforeSwitch);
    const reordered = {
      ...draft,
      placements: draft.placements.map((edge) => edge.childInstanceRef.id === "form.intake.page"
        ? { ...edge, order: 2 }
        : edge.childInstanceRef.id === "form.survey.page" ? { ...edge, order: 1 } : edge),
    };
    expect(readSystemForms(reordered, f.catalog).map(({page}) => page?.instanceId)).toEqual([
      "form.survey.page", "form.intake.page",
    ]);
    const history = commitSystemComposerDraft(createSystemComposerDraftHistory(first), draft);
    expect(readSystemForms(undoSystemComposerDraft(history).present, f.catalog).length).toBe(1);
  });

  it("opens a form in the application top bar without opening an unplaced form", () => {
    const f = fixture();
    const draft: SystemComposerDraft = {
      ...f.draft,
      instances: [...f.draft.instances, assetInstance("system.header-form", ids.form), assetInstance("system.unplaced-form", ids.form)],
      placements: [...f.draft.placements, {
        schemaVersion: ASSET_PLACEMENT_SCHEMA_VERSION, placementId: normalizeAssetId("place.header-form"),
        parentInstanceRef: instanceRef("system.shell"), slotId: normalizeAssetSlotId("top-bar"),
        childInstanceRef: instanceRef("system.header-form"), order: 0,
      }],
    };
    expect(readSystemForms(draft, f.catalog, [instanceRef("system.root")]).map(({form, page, region}) => ({
      form: form.instanceId, page: page?.instanceId, region: region?.instanceId,
    }))).toEqual([{ form: "system.header-form", page: undefined, region: "system.shell" }]);
    expect(readSystemForms(draft, f.catalog, [])).toEqual([]);
  });

});
