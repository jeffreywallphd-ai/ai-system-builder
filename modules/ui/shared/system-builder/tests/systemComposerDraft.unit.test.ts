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
  areSystemComposerDraftsEqual,
  attachUnassignedSystemComposerAsset,
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
  it("owns immutable snapshots while sharing only unchanged owned data", () => {
    const caller = baseDraft();
    const input = { ...caller, instances: caller.instances.map(instance => ({ ...instance, selectedConfiguration: { nested: { values: [false, 0, "", null] } } })) };
    const initial = createSystemComposerDraftHistory(input);
    (input.instances[0]!.selectedConfiguration.nested.values as any[]).push("external mutation");
    expect((initial.present.instances[0]!.selectedConfiguration as any).nested.values).toEqual([false, 0, "", null]);
    const changedConfiguration = { title: "Changed", nested: { value: "Before" } };
    const next = commitSystemComposerDraft(initial, { ...initial.present, instances: initial.present.instances.map((instance, index) => index === 1 ? { ...instance, selectedConfiguration: changedConfiguration } : instance) });
    changedConfiguration.nested.value = "After";
    expect((next.present.instances[1]!.selectedConfiguration as any).nested.value).toBe("Before");
    expect(next.present.instances[0]).toBe(initial.present.instances[0]);
    expect(next.present.placements).toBe(initial.present.placements);
    expect(Object.isFrozen(next)).toBe(true);
    expect(Object.isFrozen(next.past)).toBe(true);
    expect(Object.isFrozen(next.present.instances[1]!.selectedConfiguration)).toBe(true);
    expect(Object.isFrozen((next.present.instances[1]!.selectedConfiguration as any).nested)).toBe(true);
    const undone = undoSystemComposerDraft(next);
    expect(undone.present).toBe(initial.present);
    expect(redoSystemComposerDraft(undone).present).toBe(next.present);
    expect(areSystemComposerDraftsEqual(undone.present, initial.present)).toBe(true);
    expect(commitSystemComposerDraft(initial, JSON.parse(JSON.stringify(initial.present)))).toBe(initial);
  });

  it("does not trust shallow caller freezes or invoke executable snapshot fields", () => {
    const raw = baseDraft();
    const nested = { title: "Initial" };
    const shallow = Object.freeze({ ...raw, instances: raw.instances.map(instance => ({ ...instance, selectedConfiguration: nested })) });
    const history = createSystemComposerDraftHistory(shallow);
    nested.title = "Outside";
    expect(history.present.instances[0]!.selectedConfiguration?.title).toBe("Initial");
    let calls = 0;
    const hostile = Object.defineProperty({}, "title", { enumerable: true, get: () => { calls += 1; return "synthetic-private-marker"; } });
    expect(() => createSystemComposerDraftHistory({ ...raw, instances: [{ ...raw.instances[0]!, selectedConfiguration: hostile }] })).toThrow("plain data fields");
    const callback = { toJSON: () => { calls += 1; return "synthetic-private-marker"; } };
    expect(() => createSystemComposerDraftHistory({ ...raw, instances: [{ ...raw.instances[0]!, selectedConfiguration: callback as any }] })).toThrow();
    expect(calls).toBe(0);
    expect(() => areSystemComposerDraftsEqual(raw, { ...raw, instances: [{ ...raw.instances[0]!, selectedConfiguration: hostile }] })).toThrow("plain data fields");
    expect(calls).toBe(0);
  });

  it("owns externally supplied past and future entries before retaining them", () => {
    const past = baseDraft(), present = baseDraft(), future = baseDraft();
    const configured = (draft: SystemComposerDraft, title: string) => ({ ...draft, instances: draft.instances.map(instance => ({ ...instance, selectedConfiguration: { title } })) });
    const old = configured(past, "Owned past"), now = configured(present, "Owned present"), later = configured(future, "Owned future");
    const committed = commitSystemComposerDraft({ past: [old], present: now, future: [] }, configured(now, "New edit"));
    (old.instances[0]!.selectedConfiguration as any).title = "Caller changed past";
    expect(undoSystemComposerDraft(undoSystemComposerDraft(committed)).present.instances[0]!.selectedConfiguration?.title).toBe("Owned past");
    const undone = undoSystemComposerDraft({ past: [old], present: now, future: [later] });
    (later.instances[0]!.selectedConfiguration as any).title = "Caller changed future";
    expect(redoSystemComposerDraft(redoSystemComposerDraft(undone)).present.instances[0]!.selectedConfiguration?.title).toBe("Owned future");
    expect(Object.isFrozen(committed.past[0])).toBe(true);
  });
  it("moves down and up within a slot using the final requested sibling order", () => {
    let draft = baseDraft();
    for (const suffix of ["one", "two", "three"]) draft = add(draft, `instance.card.${suffix}`, "instance.shell", "content");
    for (const [suffix, order, expected] of [
      ["one", 1, ["two", "one", "three"]],
      ["one", 2, ["two", "three", "one"]],
      ["three", 0, ["three", "one", "two"]],
      ["two", 1, ["one", "two", "three"]],
    ] as const) {
      const result = reparentSystemComposerAsset(draft, { instanceId: `instance.card.${suffix}`, parentInstanceId: "instance.shell", slotId: "content", order });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const siblings = result.value.placements.filter(item => item.slotId === "content").sort((a, b) => a.order - b.order);
      expect(siblings.map(item => String(item.childInstanceRef.id))).toEqual(expected.map(id => `instance.card.${id}`));
      expect(siblings.map(item => item.order)).toEqual([0, 1, 2]);
      expect(result.value.instances).toBe(draft.instances);
    }
  });
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

  it("inserts and reparents at an absolute bounded slot order", () => {
    let draft = add(
      baseDraft(),
      "instance.card.one",
      "instance.shell",
      "content",
    );
    draft = add(draft, "instance.card.two", "instance.shell", "content");
    const inserted = addSystemComposerAsset(draft, {
      asset: asset("builtin.container.card", [{ slotId: "body" }]),
      compositionId: "composition.demo",
      parentInstanceId: "instance.shell",
      slotId: "content",
      instanceId: "instance.card.middle",
      order: 1,
    });
    expect(inserted.ok).toBe(true);
    if (!inserted.ok) return;
    expect(slotChildren(inserted.value, "instance.shell", "content")).toEqual([
      "instance.card.one",
      "instance.card.middle",
      "instance.card.two",
    ]);

    const moved = reparentSystemComposerAsset(inserted.value, {
      instanceId: "instance.card.one",
      parentInstanceId: "instance.shell",
      slotId: "content",
      order: 2,
    });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(slotChildren(moved.value, "instance.shell", "content")).toEqual([
      "instance.card.middle",
      "instance.card.two",
      "instance.card.one",
    ]);
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
    const initial = {
      ...baseDraft(),
      structure: {
        schemaVersion: "system-builder-structure.v1" as const,
        profile: "interactive" as const,
        layoutPresetRef: {
          kind: "asset-definition-version" as const,
          id: normalizeAssetId("builtin.layout.application.standard"),
          version: "2.0.0",
        },
      },
    };
    const next = add(initial, "instance.card", "instance.shell", "content");
    const changedLayout = {
      ...next,
      structure: {
        ...initial.structure,
        layoutPresetRef: {
          kind: "asset-definition-version" as const,
          id: normalizeAssetId("builtin.layout.application.minimal"),
          version: "2.0.0",
        },
      },
    };
    const committed = commitSystemComposerDraft(
      createSystemComposerDraftHistory(initial),
      changedLayout,
    );
    expect(committed.present.instances.length).toBe(3);
    const undone = undoSystemComposerDraft(committed);
    expect(undone.present.instances.length).toBe(2);
    expect(undone.present.structure?.layoutPresetRef?.id).toBe(
      "builtin.layout.application.standard",
    );
    expect(undone.future.length).toBe(1);
    const redone = redoSystemComposerDraft(undone);
    expect(redone.present.instances.length).toBe(3);
    expect(redone.present.structure?.layoutPresetRef?.id).toBe(
      "builtin.layout.application.minimal",
    );
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

  it("stops tree construction at explicit node and depth budgets", () => {
    const instances = Array.from({ length: 20 }, (_, index) =>
      instance(`instance.${index}`, "builtin.container.card"),
    );
    const placements = instances.slice(1).map((child, index) =>
      placement(
        `placement.${index}`,
        `instance.${index}`,
        "body",
        String(child.instanceId),
        0,
      ),
    );
    const draft = { instances, placements, bindings: [] };
    const tree = buildSystemComposerTree(
      draft,
      [{ kind: "asset-instance", id: normalizeAssetId("instance.0") }],
      { maximumDepth: 8, maximumNodes: 5 },
    );
    expect(flattenSystemComposerTree(tree).length).toBe(5);
    expect(() =>
      buildSystemComposerTree(draft, [], { maximumDepth: 0 }),
    ).toThrow("maximumDepth must be a positive safe integer.");
  });

  it("reattaches preserved unassigned assets without changing identity", () => {
    const card = instance("instance.card", "builtin.container.card");
    const draft = {
      ...baseDraft(),
      instances: [...baseDraft().instances, card],
    };
    const attached = attachUnassignedSystemComposerAsset(draft, {
      instanceId: "instance.card",
      parentInstanceId: "instance.shell",
      slotId: "content",
      rootInstanceIds: new Set(["instance.root"]),
    });
    expect(attached.ok).toBe(true);
    if (!attached.ok) return;
    expect(attached.value.instances).toEqual(draft.instances);
    expect(
      attached.value.placements.find(
        (placement) =>
          String(placement.childInstanceRef.id) === "instance.card",
      ),
    ).toMatchObject({
      parentInstanceRef: { id: "instance.shell" },
      slotId: "content",
      order: 0,
    });
    const protectedRoot = attachUnassignedSystemComposerAsset(draft, {
      instanceId: "instance.root",
      parentInstanceId: "instance.shell",
      slotId: "content",
      rootInstanceIds: new Set(["instance.root"]),
    });
    expect(protectedRoot.ok).toBe(false);
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

function slotChildren(
  draft: SystemComposerDraft,
  parentInstanceId: string,
  slotId: string,
): readonly string[] {
  return draft.placements
    .filter(
      (item) =>
        String(item.parentInstanceRef.id) === parentInstanceId &&
        item.slotId === slotId,
    )
    .sort((left, right) => left.order - right.order)
    .map((item) => String(item.childInstanceRef.id));
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


it("preserves layout structure through subtree removal and undo/redo serialization", () => {
  const structure = { schemaVersion: "system-builder-structure.v1" as const, profile: "interactive" as const,
    layoutPresetRef: { kind: "asset-definition-version" as const, id: normalizeAssetId("builtin.layout.application.standard"), version: "2.0.0" } };
  const before = add({ ...baseDraft(), structure }, "instance.card", "instance.shell", "content");
  const removed = removeSystemComposerSubtree(before, "instance.card", new Set(["instance.root", "instance.shell"]));
  expect(removed.ok).toBe(true); if (!removed.ok) return;
  expect(removed.value.structure).toEqual(structure);
  const committed = commitSystemComposerDraft(createSystemComposerDraftHistory(before), removed.value);
  expect(undoSystemComposerDraft(committed).present.structure).toEqual(structure);
  expect(redoSystemComposerDraft(undoSystemComposerDraft(committed)).present.structure).toEqual(structure);
  expect(JSON.parse(JSON.stringify(removed.value)).structure).toEqual(structure);
});
