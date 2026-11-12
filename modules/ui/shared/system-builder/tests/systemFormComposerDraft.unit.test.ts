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
  createSystemFormDraft,
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
function fixture(pageCapacity = 8) {
  const shell = asset(shellId, [
    { ...slot("top-bar", ids.page, 1), acceptedDefinitionRefs: undefined, acceptedAssetTypes: ["page", "ui-component"] },
    slot("content", ids.page, pageCapacity),
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
function input(f: ReturnType<typeof fixture>, suffix: string) {
  return {
    name: `Form ${suffix}`, rootInstanceId: "system.root", compositionId: "system.composition",
    instanceIds: {
      page: `form.${suffix}.page`, section: `form.${suffix}.section`,
      form: `form.${suffix}.form`, step: `form.${suffix}.step`,
    },
    assets: f.assets, catalog: f.catalog,
  };
}

describe("Form Composer draft placements", () => {
  it("creates two forms on separate Canvas pages and reads them repeatedly without new placements", () => {
    const f = fixture();
    const first = createSystemFormDraft(f.draft, input(f, "intake"));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = createSystemFormDraft(first.value, input(f, "survey"));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const draft = structuredClone(second.value);
    const forms = readSystemForms(draft, f.catalog);
    expect(forms.map(({page, form, steps}) => [
      page.instanceId, form.instanceId, steps.map((step) => step.instanceId),
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
    expect(readSystemForms(reordered, f.catalog).map(({page}) => page.instanceId)).toEqual([
      "form.survey.page", "form.intake.page",
    ]);
    const history = commitSystemComposerDraft(createSystemComposerDraftHistory(first.value), draft);
    expect(readSystemForms(undoSystemComposerDraft(history).present, f.catalog).length).toBe(1);
  });

  it("preserves the original draft if the page region is full or an exact form asset is unavailable", () => {
    const full = fixture(1);
    const before = JSON.stringify(full.draft);
    expect(createSystemFormDraft(full.draft, input(full, "new"))).toEqual({
      ok: false, message: "The selected application layout has no available page region.",
    });
    expect(JSON.stringify(full.draft)).toBe(before);
    const f = fixture();
    expect(createSystemFormDraft(f.draft, {
      ...input(f, "new"), assets: { ...f.assets, form: { ...f.assets.form, builtIn: false } },
    }).ok).toBe(false);
    const requested = input(f, "new");
    expect(createSystemFormDraft(f.draft, {
      ...requested, instanceIds: { ...requested.instanceIds, form: " form.new.form " },
    }).ok).toBe(false);
    expect(readSystemForms(f.draft, f.catalog)).toEqual([]);
  });

  it("does not put a form in the top bar when both Split workspace page hosts are full", () => {
    const f = fixture();
    const split = "builtin.layout.application.split-workspace";
    const shell = asset(split, [f.catalog[0]!.slots[0]!, slot("start-panel", ids.page, 1), slot("end-panel", ids.page, 1)], "application-shell");
    const draft: SystemComposerDraft = {
      ...f.draft,
      instances: [
        ...f.draft.instances.map((item) => item.instanceId === "system.shell"
          ? { ...item, definitionRef: ref(split) } : item),
        assetInstance("system.second-page", ids.page),
      ],
      placements: [
        f.draft.placements[0]!,
        { ...f.draft.placements[1]!, slotId: normalizeAssetSlotId("start-panel") },
        { ...f.draft.placements[1]!, placementId: normalizeAssetId("place.second-page"),
          slotId: normalizeAssetSlotId("end-panel"), childInstanceRef: instanceRef("system.second-page") },
      ],
      structure: { ...f.draft.structure!, layoutPresetRef: ref(split) },
    };
    expect(createSystemFormDraft(draft, { ...input(f, "new"), catalog: [shell, ...Object.values(f.assets)] })).toEqual({
      ok: false, message: "The selected application layout has no available page region.",
    });
    expect(draft.instances.length).toBe(4);
  });
});
