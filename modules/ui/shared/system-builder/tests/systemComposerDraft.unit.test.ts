import { describe, expect, it } from "../../../../testing/node-test";
import type {
  AssetInstance,
  AssetPlacement,
} from "../../../../contracts/asset";
import {
  ASSET_PLACEMENT_SCHEMA_VERSION,
  normalizeAssetId,
  normalizeAssetSlotId,
} from "../../../../contracts/asset";
import type { SystemBuilderComposerAsset } from "../../../../contracts/system-builder";
import {
  addSystemComposerAsset,
  buildSystemComposerTree,
  commitSystemComposerDraft,
  createSystemComposerDraftHistory,
  deriveProtectedSystemInstanceIds,
  flattenSystemComposerTree,
  moveSystemComposerPlacement,
  redoSystemComposerDraft,
  removeSystemComposerSubtree,
  reparentSystemComposerAsset,
  undoSystemComposerDraft,
  wrapSystemComposerAsset,
  type SystemComposerDraft,
} from "../systemComposerDraft";

describe("System composer draft operations", () => {
  it("adds nested assets and builds the canonical placement hierarchy", () => {
    const result = addSystemComposerAsset(baseDraft(), {
      asset: asset("builtin.card", [{ slotId: "body" }]),
      compositionId: "composition.demo",
      parentInstanceId: "instance.shell",
      slotId: "content",
      instanceId: "instance.card.one",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.instances.length).toBe(3);
    expect(result.value.placements.length).toBe(2);
    const tree = buildSystemComposerTree(result.value, [
      { kind: "asset-instance", id: normalizeAssetId("instance.root") },
    ]);
    expect(
      flattenSystemComposerTree(tree).map((node) =>
        String(node.instance.instanceId),
      ),
    ).toEqual(["instance.root", "instance.shell", "instance.card.one"]);
  });

  it("reorders and reparents placements without changing instance identity", () => {
    let draft = add(
      baseDraft(),
      "instance.card.one",
      "instance.shell",
      "content",
    );
    draft = add(draft, "instance.card.two", "instance.shell", "content");
    const moved = moveSystemComposerPlacement(draft, "instance.card.two", -1);
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(
      moved.value.placements
        .filter((placement) => placement.slotId === "content")
        .sort((left, right) => left.order - right.order)
        .map((placement) => String(placement.childInstanceRef.id)),
    ).toEqual(["instance.card.two", "instance.card.one"]);

    const reparented = reparentSystemComposerAsset(moved.value, {
      instanceId: "instance.card.one",
      parentInstanceId: "instance.card.two",
      slotId: "body",
    });
    expect(reparented.ok).toBe(true);
    if (!reparented.ok) return;
    expect(
      reparented.value.placements.find(
        (placement) =>
          String(placement.childInstanceRef.id) === "instance.card.one",
      )?.parentInstanceRef.id,
    ).toBe("instance.card.two");
    const cyclic = reparentSystemComposerAsset(reparented.value, {
      instanceId: "instance.card.two",
      parentInstanceId: "instance.card.one",
      slotId: "body",
    });
    expect(cyclic.ok).toBe(false);
  });

  it("wraps assets, removes bounded subtrees, and protects required nodes", () => {
    const draft = add(
      baseDraft(),
      "instance.card",
      "instance.shell",
      "content",
    );
    const wrapped = wrapSystemComposerAsset(draft, {
      instanceId: "instance.card",
      wrapper: asset("builtin.container.card", [{ slotId: "body" }]),
      wrapperInstanceId: "instance.wrapper",
      wrapperSlotId: "body",
      compositionId: "composition.demo",
    });
    expect(wrapped.ok).toBe(true);
    if (!wrapped.ok) return;
    expect(
      wrapped.value.placements.find(
        (placement) =>
          String(placement.childInstanceRef.id) === "instance.card",
      )?.parentInstanceRef.id,
    ).toBe("instance.wrapper");

    const protectedRemoval = removeSystemComposerSubtree(
      wrapped.value,
      "instance.shell",
      new Set(["instance.root", "instance.shell"]),
    );
    expect(protectedRemoval.ok).toBe(false);
    const removed = removeSystemComposerSubtree(
      wrapped.value,
      "instance.wrapper",
      new Set(["instance.root", "instance.shell"]),
    );
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(
      removed.value.instances.map((item) => String(item.instanceId)),
    ).toEqual(["instance.root", "instance.shell"]);
  });

  it("keeps local undo and redo bounded to the unsaved canonical draft", () => {
    const initial = baseDraft();
    const next = add(initial, "instance.card", "instance.shell", "content");
    const committed = commitSystemComposerDraft(
      createSystemComposerDraftHistory(initial),
      next,
    );
    expect(committed.present.instances.length).toBe(3);
    const undone = undoSystemComposerDraft(committed);
    expect(undone.present.instances.length).toBe(2);
    expect(undone.future.length).toBe(1);
    const redone = redoSystemComposerDraft(undone);
    expect(redone.present.instances.length).toBe(3);
    expect(redone.past.length).toBe(1);
  });

  it("derives protected required-slot descendants from catalog cardinality", () => {
    const draft = baseDraft();
    const rootAsset = asset("builtin.system.system", [
      { slotId: "application-shell", minItems: 1 },
    ]);
    const protectedIds = deriveProtectedSystemInstanceIds(
      draft,
      [{ kind: "asset-instance", id: normalizeAssetId("instance.root") }],
      [rootAsset, asset("builtin.layout.application.standard")],
    );
    expect([...protectedIds]).toEqual(["instance.root", "instance.shell"]);
  });
});

function baseDraft(): SystemComposerDraft {
  const root = instance("instance.root", "builtin.system.system");
  const shell = instance(
    "instance.shell",
    "builtin.layout.application.standard",
  );
  return {
    instances: [root, shell],
    placements: [
      placement(
        "placement.root-shell",
        "instance.root",
        "application-shell",
        "instance.shell",
        0,
      ),
    ],
    bindings: [],
  };
}

function add(
  draft: SystemComposerDraft,
  instanceId: string,
  parentInstanceId: string,
  slotId: string,
): SystemComposerDraft {
  const result = addSystemComposerAsset(draft, {
    asset: asset("builtin.container.card", [{ slotId: "body" }]),
    compositionId: "composition.demo",
    parentInstanceId,
    slotId,
    instanceId,
  });
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

function instance(instanceId: string, definitionId: string): AssetInstance {
  return {
    instanceId: normalizeAssetId(instanceId),
    definitionRef: {
      kind: "asset-definition-version",
      id: normalizeAssetId(definitionId),
      version: "2.0.0",
    },
    displayName: definitionId,
    lifecycleStatus: "draft",
    selectedConfiguration: {},
    provenance: { sourceKind: "system-generated" },
  };
}

function placement(
  placementId: string,
  parent: string,
  slotId: string,
  child: string,
  order: number,
): AssetPlacement {
  return {
    schemaVersion: ASSET_PLACEMENT_SCHEMA_VERSION,
    placementId: normalizeAssetId(placementId),
    parentInstanceRef: {
      kind: "asset-instance",
      id: normalizeAssetId(parent),
    },
    slotId: normalizeAssetSlotId(slotId),
    childInstanceRef: {
      kind: "asset-instance",
      id: normalizeAssetId(child),
    },
    order,
  };
}

function asset(
  definitionId: string,
  slots: readonly {
    readonly slotId: string;
    readonly minItems?: number;
  }[] = [],
): SystemBuilderComposerAsset {
  return {
    definitionRef: {
      kind: "asset-definition-version",
      id: normalizeAssetId(definitionId),
      version: "2.0.0",
    },
    definitionId,
    version: "2.0.0",
    displayName: definitionId,
    description: `${definitionId} description`,
    assetType: "ui-component",
    assetFamily: "structural",
    lifecycleStatus: "published",
    builtIn: true,
    ports: [],
    slots: slots.map((slot) => ({
      schemaVersion: "asset-slot-definition.v1",
      slotId: normalizeAssetSlotId(slot.slotId),
      displayName: slot.slotId,
      cardinality: { minItems: slot.minItems ?? 0, maxItems: 8 },
      acceptedAssetTypes: ["ui-component"],
    })),
    compatibility: { status: "compatible" },
    implementationAvailability: "trusted-system-foundation",
    previewAvailability: "trusted-declarative",
  };
}
